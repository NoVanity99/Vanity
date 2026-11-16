import { normalizeRoomCode, type VoiceIceServer, type VoicePeer, type VoiceServerMessage, type VoiceUser } from '@shared/voiceProtocol'
import { DEFAULT_VOICE, type PeerVolume, type VoiceSettings } from '@shared/voiceSettings'
import { AudioEngine, listDevices, type AudioDevices, type VoiceSound } from './audio'
import { newSessionId, qualityOf, SpeechDetector, type Quality } from './detect'
import { VoiceError } from './errors'
import { MeshTransport } from './mesh'
import { SignalingClient } from './signaling'
import type { PeerLink, VoiceTransport } from './transport'

export type VoiceStatus = 'idle' | 'connecting' | 'in-room' | 'reconnecting' | 'error'

export interface VoiceMember {
  /** This visit's id in the room. */
  id: string
  user: VoiceUser
  you: boolean
  muted: boolean
  deafened: boolean
  /** False for a few seconds while their connection drops and comes back. */
  connected: boolean
  speaking: boolean
  /** Their volume for you (0–2), and whether you muted them for yourself. */
  volume: number
  localMuted: boolean
  link: PeerLink | null
}

export interface VoiceSnapshot {
  status: VoiceStatus
  /** The room's invite code. */
  code: string | null
  /** You first, then everyone else in the order they joined. */
  members: VoiceMember[]
  muted: boolean
  deafened: boolean
  speaking: boolean
  /** False: no microphone could be opened, so you can only listen. */
  micAvailable: boolean
  /** Push-to-talk key held (or just let go). */
  pushToTalk: boolean
  error: VoiceError | null
  /** Something worth saying that isn't an error ("Microphone unplugged, switched to…"). */
  notice: string | null
  /** Round trip in ms: to the people in the room, or to the server when alone. */
  ping: number | null
  quality: Quality
  /** Reconnect attempt number while reconnecting. */
  attempt: number
}

export interface VoiceDeps {
  /** The voice server's address, or '' when none is set. */
  serverUrl(): string
  /** A fresh Vanity sign-in token. Throws when signed out. */
  token(): Promise<string>
  settings(): VoiceSettings
  /** Saves someone's volume for you (by their Vanity account id). */
  saveVolume(userId: string, volume: PeerVolume | null): void
  /** Builds the transport (the mesh now; a media server later). */
  transport?: (events: ConstructorParameters<typeof MeshTransport>[0]) => VoiceTransport
}

const TICK_MS = 50
const REMOTE_SPEAKING_DB = -55

type Pending = { kind: 'create' } | { kind: 'join'; code: string }

/**
 * The voice engine: one per app. It owns the connection to the signaling server, the audio
 * (through AudioEngine) and the connections to other players (through a VoiceTransport), and
 * tells the screens what's going on through `subscribe`. Nothing in here draws anything.
 */
export class VoiceClient {
  private audio: AudioEngine | null = null
  private signaling: SignalingClient | null = null
  private transport: VoiceTransport | null = null
  private ice: VoiceIceServer[] = []
  private session = ''
  private pending: Pending | null = null
  private me: VoiceUser | null = null
  private myId = ''
  private peers = new Map<string, VoicePeer & { speaking: boolean; link: PeerLink | null; detector: SpeechDetector }>()
  private selfDetector = new SpeechDetector(DEFAULT_VOICE.sensitivityDb)
  private pttDown = false
  private pttUntil = 0
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private measureTimer: ReturnType<typeof setInterval> | null = null
  private testing = false
  private gateOpen = false
  private levelListeners = new Set<(db: number) => void>()
  private listeners = new Set<(s: VoiceSnapshot) => void>()
  private snap: VoiceSnapshot = {
    status: 'idle',
    code: null,
    members: [],
    muted: false,
    deafened: false,
    speaking: false,
    micAvailable: true,
    pushToTalk: false,
    error: null,
    notice: null,
    ping: null,
    quality: 'unknown',
    attempt: 0
  }
  private wasMutedBeforeDeafen = false

  constructor(private deps: VoiceDeps) {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', () => void this.onDevicesChanged())
    }
  }

  // ---- what the screens use ------------------------------------------------------

  get snapshot(): VoiceSnapshot {
    return this.snap
  }

  subscribe(listener: (s: VoiceSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Your microphone level (dB), about 20 times a second, while in a room or testing. */
  onLevel(listener: (db: number) => void): () => void {
    this.levelListeners.add(listener)
    return () => {
      this.levelListeners.delete(listener)
    }
  }

  get inRoom(): boolean {
    return this.snap.status === 'in-room' || this.snap.status === 'reconnecting' || (this.snap.status === 'connecting' && !!this.pending)
  }

  async create(): Promise<void> {
    await this.begin({ kind: 'create' })
  }

  async join(input: string): Promise<void> {
    const code = normalizeRoomCode(input)
    if (!code) return this.fail(new VoiceError('not-found', "That isn't a room code. Codes are 6 letters and numbers, like K7M2QX."))
    await this.begin({ kind: 'join', code })
  }

  leave(): void {
    const was = this.snap.status === 'in-room'
    this.signaling?.send({ t: 'leave' })
    this.teardown()
    if (was) this.sound('self-leave')
    this.set({ status: 'idle', code: null, members: [], error: null, notice: null, ping: null, quality: 'unknown', speaking: false, attempt: 0 })
  }

  /** "Try again" after an error, or "Reconnect now" while reconnecting. */
  retry(): void {
    if (this.snap.status === 'reconnecting') return this.signaling?.retryNow()
    const code = this.snap.code
    if (code) void this.join(code)
  }

  dismissNotice(): void {
    this.set({ notice: null, error: this.snap.status === 'error' ? this.snap.error : null })
  }

  toggleMute(): void {
    if (!this.snap.micAvailable) return this.set({ notice: 'No microphone is working, so you can only listen. Check Settings → Voice.' })
    if (this.snap.deafened) {
      // Unmuting while deafened undeafens too, like most voice apps.
      this.set({ deafened: false, muted: false })
      this.sound('undeafen')
    } else {
      this.set({ muted: !this.snap.muted })
      this.sound(this.snap.muted ? 'mute' : 'unmute')
    }
    this.applyOutput()
    this.sendState()
  }

  toggleDeafen(): void {
    if (this.snap.deafened) {
      this.set({ deafened: false, muted: this.wasMutedBeforeDeafen || !this.snap.micAvailable })
      this.sound('undeafen')
    } else {
      this.wasMutedBeforeDeafen = this.snap.muted
      this.set({ deafened: true, muted: true })
      this.sound('deafen')
    }
    this.applyOutput()
    this.sendState()
  }

  /** Someone's volume for you, 0–2 (0–200%). Saved, so it's the same next time. */
  setPeerVolume(peerId: string, volume: number): void {
    const p = this.peers.get(peerId)
    if (!p) return
    const v = Math.min(2, Math.max(0, volume))
    const cur = this.volumeFor(p.user.id)
    this.deps.saveVolume(p.user.id, v === 1 && !cur.muted ? null : { volume: v, muted: cur.muted })
    this.audio?.setRemoteVolume(peerId, cur.muted ? 0 : v)
    this.emitMembers({ [p.user.id]: { volume: v, muted: cur.muted } })
  }

  /** Mute someone for yourself only. */
  setPeerMuted(peerId: string, muted: boolean): void {
    const p = this.peers.get(peerId)
    if (!p) return
    const cur = this.volumeFor(p.user.id)
    this.deps.saveVolume(p.user.id, cur.volume === 1 && !muted ? null : { volume: cur.volume, muted })
    this.audio?.setRemoteVolume(peerId, muted ? 0 : cur.volume)
    this.emitMembers({ [p.user.id]: { volume: cur.volume, muted } })
  }

  /** The push-to-talk key went down or up (from the global hotkey, or the on-screen button). */
  pushToTalk(down: boolean): void {
    if (down === this.pttDown) return
    this.pttDown = down
    if (!down) this.pttUntil = performance.now() + this.deps.settings().pttReleaseMs
    this.set({ pushToTalk: down })
  }

  /** Settings changed: devices, volumes, sensitivity, processing. */
  async applySettings(): Promise<void> {
    const s = this.deps.settings()
    this.selfDetector.thresholdDb = s.sensitivityDb
    if (!this.audio) return
    this.audio.setInputVolume(s.inputVolume)
    this.applyOutput()
    await this.audio.setOutputDevice(s.outputDeviceId)
    for (const p of this.peers.values()) {
      const v = this.volumeFor(p.user.id)
      this.audio.setRemoteVolume(p.id, v.muted ? 0 : v.volume)
    }
    if (this.inRoom || this.testing) await this.openMic()
    this.emitMembers()
  }

  // ---- the microphone test (Settings → Voice) ---------------------------------------

  /** Opens the microphone for the level meter, without joining anything. */
  async startMicTest(): Promise<void> {
    this.testing = true
    await this.ensureAudio()
    await this.openMic()
    this.startTicking()
  }

  stopMicTest(): void {
    this.testing = false
    this.audio?.setMonitor(false)
    if (!this.inRoom) {
      this.audio?.closeMic()
      this.stopTicking()
    }
  }

  /** Hear your own microphone (in the test). */
  setMonitor(on: boolean): void {
    this.audio?.setMonitor(on && this.testing)
  }

  async devices(): Promise<AudioDevices> {
    return listDevices()
  }

  // ---- inside ------------------------------------------------------------------------

  private set(patch: Partial<VoiceSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    for (const l of this.listeners) l(this.snap)
  }

  private fail(error: VoiceError): void {
    this.set({ status: 'error', error, attempt: 0, members: [], speaking: false })
  }

  private sound(s: VoiceSound): void {
    if (this.deps.settings().soundEffects) this.audio?.play(s)
  }

  private volumeFor(userId: string): PeerVolume {
    return this.deps.settings().userVolumes[userId] ?? { volume: 1, muted: false }
  }

  private async ensureAudio(): Promise<AudioEngine> {
    if (!this.audio) {
      this.audio = new AudioEngine()
      this.audio.onMicEnded = () => void this.onMicLost()
      const s = this.deps.settings()
      this.audio.setInputVolume(s.inputVolume)
      await this.audio.setOutputDevice(s.outputDeviceId)
    }
    await this.audio.resume()
    this.applyOutput()
    return this.audio
  }

  private applyOutput(): void {
    this.audio?.setOutput(this.deps.settings().outputVolume, this.snap.deafened)
  }

  /** Opens the microphone from the settings. Without one, you can still join and listen. */
  private async openMic(): Promise<boolean> {
    const audio = await this.ensureAudio()
    const s = this.deps.settings()
    if (!navigator.mediaDevices?.getUserMedia) {
      this.set({ micAvailable: false, muted: true, notice: "Voice isn't available in this version of the app." })
      return false
    }
    try {
      await audio.openMic(s)
      this.set({ micAvailable: true, ...(this.snap.error && /mic|microphone/i.test(this.snap.error.code) ? { error: null } : {}) })
      return true
    } catch (err) {
      const e = err instanceof VoiceError ? err : new VoiceError('mic-busy', 'Your microphone could not be started.')
      this.set({ micAvailable: false, muted: true, notice: e.message })
      return false
    }
  }

  private async onMicLost(): Promise<void> {
    if (!this.inRoom && !this.testing) return
    // Try the default microphone instead.
    const ok = await this.openMic()
    if (ok) this.set({ notice: 'Your microphone stopped (unplugged?). Switched to the default microphone.' })
    else this.set({ notice: 'Your microphone stopped and no other one was found. You can still listen; plug one in to talk again.' })
    this.sendState()
  }

  private async onDevicesChanged(): Promise<void> {
    if (!this.audio || (!this.inRoom && !this.testing)) return
    const s = this.deps.settings()
    const { inputs, outputs } = await listDevices()
    if (s.outputDeviceId && !outputs.some((o) => o.id === s.outputDeviceId)) {
      await this.audio.setOutputDevice('')
      this.set({ notice: 'Your speakers or headset were unplugged. Sound now plays on the default device.' })
    } else if (s.outputDeviceId) {
      // Plugged back in: use it again.
      await this.audio.setOutputDevice(s.outputDeviceId)
    }
    if (!this.snap.micAvailable && inputs.length) {
      if (await this.openMic()) this.set({ notice: 'A microphone was found. You can talk again.' })
    } else if (s.inputDeviceId && inputs.some((i) => i.id === s.inputDeviceId) && this.audio.micDeviceId !== s.inputDeviceId) {
      await this.openMic()
    }
  }

  private async begin(action: Pending): Promise<void> {
    if (this.inRoom) this.leave()
    const url = this.deps.serverUrl()
    if (!url) return this.fail(new VoiceError('not-configured', "Voice isn't set up yet: this copy of Vanity doesn't know a voice server. Add one in Settings → Voice."))
    if (typeof RTCPeerConnection === 'undefined') return this.fail(new VoiceError('unsupported', "Voice isn't available in this version of the app."))
    this.set({ status: 'connecting', error: null, notice: null, code: action.kind === 'join' ? action.code : null, members: [], attempt: 0 })
    this.pending = action
    this.session = newSessionId()
    await this.ensureAudio()
    const s = this.deps.settings()
    this.selfDetector.thresholdDb = s.sensitivityDb
    const micOk = await this.openMic()
    // A fresh call starts unmuted (or muted when there's no microphone to talk with).
    this.set({ muted: !micOk, deafened: false })
    this.startSignaling(url)
  }

  private startSignaling(url: string): void {
    this.signaling?.stop()
    let everConnected = false
    this.signaling = new SignalingClient({
      url,
      token: () => this.deps.token(),
      onStatus: (status, attempt) => {
        if (status === 'reconnecting') {
          // Never reached the server at all after a few tries: say so, rather than spinning forever.
          if (!everConnected && attempt >= 3) {
            this.signaling?.stop()
            this.teardown()
            return this.fail(new VoiceError('unreachable', `Can't reach the voice server (${url.replace(/^wss?:\/\//, '')}). Check your internet connection; the server may also be down.`))
          }
          if (this.snap.status === 'in-room' || this.snap.status === 'reconnecting') this.set({ status: 'reconnecting', attempt })
        }
      },
      onWelcome: (msg) => {
        everConnected = true
        this.me = msg.you
        this.ice = msg.ice
        this.transport?.setIceServers(msg.ice)
        if (this.pending) {
          const p = this.pending
          this.signaling?.send(p.kind === 'create' ? { t: 'create', session: this.session } : { t: 'join', code: p.code, session: this.session })
        } else if (this.snap.code) {
          // Back after a dropped connection: the same place in the same room.
          this.signaling?.send({ t: 'join', code: this.snap.code, session: this.session, resume: true })
        }
      },
      onMessage: (msg) => this.onServer(msg),
      onFatal: (msg) => {
        this.teardown()
        if (msg.code === 'replaced') {
          this.set({ status: 'idle', code: null, members: [], notice: msg.message, error: null })
        } else {
          this.fail(new VoiceError(msg.code === 'auth' ? 'signed-out' : 'version', msg.message))
        }
      }
    })
    this.signaling.start()
  }

  private onServer(msg: VoiceServerMessage): void {
    switch (msg.t) {
      case 'room': {
        // Back after a drop: either the server kept our place, or (after a server restart) we're back under the same visit id.
        const resumed = this.myId === msg.you && (msg.resumed || this.peers.size > 0 || this.snap.status === 'reconnecting')
        this.pending = null
        this.myId = msg.you
        if (!this.transport) {
          const make = this.deps.transport ?? ((events) => new MeshTransport(events))
          this.transport = make({
            signal: (to, data) => this.signaling?.send({ t: 'signal', to, data }),
            remoteStream: (id, stream) => {
              this.audio?.addRemote(id, stream)
              const p = this.peers.get(id)
              if (p) {
                const v = this.volumeFor(p.user.id)
                this.audio?.setRemoteVolume(id, v.muted ? 0 : v.volume)
              }
            },
            remoteGone: (id) => this.audio?.removeRemote(id),
            link: (id, link) => {
              const p = this.peers.get(id)
              if (!p) return
              p.link = link
              this.emitMembers()
            }
          })
          this.transport.start({ myId: msg.you, localTrack: this.audio!.sendTrack, iceServers: this.ice })
        }
        const ids = new Set(msg.peers.map((p) => p.id))
        // Anyone who left while we were away.
        for (const id of [...this.peers.keys()]) {
          if (!ids.has(id)) {
            this.peers.delete(id)
            this.transport.removePeer(id)
          }
        }
        for (const p of msg.peers) {
          const known = this.peers.get(p.id)
          this.peers.set(p.id, { ...p, speaking: known?.speaking ?? false, link: known?.link ?? null, detector: known?.detector ?? new SpeechDetector(REMOTE_SPEAKING_DB, 20, 300) })
          // Fresh connections after coming back: the old ones may be broken.
          if (resumed) this.transport.resetPeer(p.id)
          else this.transport.addPeer(p.id)
        }
        if (!resumed) this.sound('self-join')
        this.set({ status: 'in-room', code: msg.code, error: null, attempt: 0 })
        this.sendState()
        this.startTicking()
        this.startMeasuring()
        this.emitMembers()
        return
      }
      case 'peer-joined': {
        this.peers.set(msg.peer.id, { ...msg.peer, speaking: false, link: null, detector: new SpeechDetector(REMOTE_SPEAKING_DB, 20, 300) })
        this.transport?.addPeer(msg.peer.id)
        this.sound('join')
        return this.emitMembers()
      }
      case 'peer-left': {
        if (!this.peers.delete(msg.id)) return
        this.transport?.removePeer(msg.id)
        this.sound('leave')
        return this.emitMembers()
      }
      case 'peer-state': {
        const p = this.peers.get(msg.id)
        if (!p) return
        const cameBack = !p.connected && msg.connected
        Object.assign(p, { muted: msg.muted, deafened: msg.deafened, connected: msg.connected })
        if (cameBack) this.transport?.resetPeer(msg.id)
        return this.emitMembers()
      }
      case 'signal':
        void this.transport?.handleSignal(msg.from, msg.data)
        return
      case 'error': {
        // Couldn't get into the room (a wrong code, full): stop here.
        if (this.pending || this.snap.status !== 'in-room') {
          this.teardown()
          const code = msg.code === 'full' ? 'full' : msg.code === 'not-found' ? 'not-found' : 'server'
          return this.fail(new VoiceError(code, msg.message))
        }
        return this.set({ notice: msg.message })
      }
    }
  }

  private sendState(): void {
    this.signaling?.send({ t: 'state', muted: this.snap.muted, deafened: this.snap.deafened })
  }

  private emitMembers(override: Record<string, PeerVolume> = {}): void {
    const members: VoiceMember[] = []
    if (this.me && this.myId && this.snap.status !== 'idle') {
      members.push({
        id: this.myId,
        user: this.me,
        you: true,
        muted: this.snap.muted,
        deafened: this.snap.deafened,
        connected: this.snap.status !== 'reconnecting',
        speaking: this.snap.speaking,
        volume: 1,
        localMuted: false,
        link: null
      })
    }
    const others = [...this.peers.values()].sort((a, b) => a.joinedAt - b.joinedAt)
    for (const p of others) {
      const v = override[p.user.id] ?? this.volumeFor(p.user.id)
      members.push({ id: p.id, user: p.user, you: false, muted: p.muted, deafened: p.deafened, connected: p.connected, speaking: p.speaking, volume: v.volume, localMuted: v.muted, link: p.link })
    }
    const links = others.map((p) => p.link).filter((l): l is PeerLink => !!l && l.state === 'connected')
    const rtts = links.map((l) => l.rttMs).filter((r): r is number => r !== null)
    const ping = rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : (this.signaling?.rtt ?? null)
    const order: Quality[] = ['poor', 'ok', 'good', 'unknown']
    const worst = links.length ? links.map((l) => l.quality).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] : qualityOf(this.signaling?.rtt ?? null, null)
    this.set({ members, ping, quality: worst })
  }

  private startTicking(): void {
    if (this.tickTimer) return
    this.tickTimer = setInterval(() => this.tick(), TICK_MS)
  }

  private stopTicking(): void {
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.tickTimer = null
  }

  private startMeasuring(): void {
    if (this.measureTimer) return
    this.measureTimer = setInterval(() => {
      void this.transport?.measure().then(() => this.emitMembers())
    }, 2000)
  }

  private tick(): void {
    const audio = this.audio
    if (!audio) return
    const now = performance.now()
    const db = audio.inputLevelDb()
    for (const l of this.levelListeners) l(db)
    const s = this.deps.settings()
    this.selfDetector.thresholdDb = s.sensitivityDb
    const loud = this.selfDetector.update(db, now, TICK_MS)
    const pttOn = this.pttDown || now < this.pttUntil
    const canTalk = this.snap.status === 'in-room' && this.snap.micAvailable && !this.snap.muted && !this.snap.deafened
    const talking = canTalk && (s.inputMode === 'ptt' ? pttOn && db > -95 : loud)
    // The gate follows push-to-talk exactly (so the first word isn't lost), and voice detection otherwise.
    const gate = canTalk && (s.inputMode === 'ptt' ? pttOn : loud)
    if (gate !== this.gateOpen) {
      this.gateOpen = gate
      audio.setGate(gate)
    }
    let changed = talking !== this.snap.speaking
    if (changed) this.snap = { ...this.snap, speaking: talking }
    for (const p of this.peers.values()) {
      const speaking = p.connected && !p.muted && p.detector.update(audio.remoteLevelDb(p.id), now, TICK_MS)
      if (speaking !== p.speaking) {
        p.speaking = speaking
        changed = true
      }
    }
    if (changed) this.emitMembers()
  }

  private teardown(): void {
    this.pending = null
    this.signaling?.stop()
    this.signaling = null
    this.transport?.close()
    this.transport = null
    for (const id of this.peers.keys()) this.audio?.removeRemote(id)
    this.peers.clear()
    this.myId = ''
    this.gateOpen = false
    this.audio?.setGate(false)
    if (this.measureTimer) clearInterval(this.measureTimer)
    this.measureTimer = null
    if (!this.testing) {
      this.audio?.closeMic()
      this.stopTicking()
    }
    this.pttDown = false
    this.pttUntil = 0
  }
}
