import type { VoicePeer, VoiceSignal, VoiceUpdate, VoiceUser } from '@shared/voiceProtocol'
import { DEFAULT_VOICE, type PeerVolume, type VoiceSettings } from '@shared/voiceSettings'
import { AudioEngine, listDevices, type AudioDevices, type VoiceSound } from './audio'
import { newSessionId, qualityOf, SpeechDetector, type Quality } from './detect'
import { VoiceError } from './errors'
import { MeshTransport } from './mesh'
import type { ScreenAudioStart } from '@shared/ipc'
import type { PeerLink, VoiceTransport } from './transport'

export type VoiceStatus = 'idle' | 'connecting' | 'in-room' | 'reconnecting' | 'error'

export interface VoiceMember {
  /** Their Vanity account id. */
  id: string
  user: VoiceUser
  you: boolean
  host: boolean
  muted: boolean
  deafened: boolean
  /** Sharing their screen. */
  sharing: boolean
  /** Their camera is on. */
  camera: boolean
  /** False for a few seconds while their connection drops and comes back. */
  connected: boolean
  speaking: boolean
  /** Their volume for you (0–2), and whether you muted them for yourself. */
  volume: number
  localMuted: boolean
  link: PeerLink | null
}

export interface VoiceRoomInfo {
  id: string
  hostId: string
  private: boolean
  locked: boolean
}

/** How sharp and smooth a shared screen is. More of either uses more upload, for each person watching. */
export const SHARE_QUALITY = {
  smooth: { label: '720p · 30 fps', hint: 'Best on slower internet', width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  sharp: { label: '1080p · 30 fps', hint: 'Sharp text and pictures', width: 1920, height: 1080, fps: 30, bitrate: 4_000_000 },
  fast: { label: '1080p · 60 fps', hint: 'For games and video', width: 1920, height: 1080, fps: 60, bitrate: 6_000_000 }
} as const
export type ShareQuality = keyof typeof SHARE_QUALITY

export interface VoiceSnapshot {
  status: VoiceStatus
  /** The room you're in (or joining). */
  room: VoiceRoomInfo | null
  /** You started the room (or it passed to you): you set private and locked. */
  isHost: boolean
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
  /** Round trip in ms: to the people in the room, or to the Vanity server when alone. */
  ping: number | null
  quality: Quality
  /** Failed check-ins in a row while reconnecting. */
  attempt: number
  /** What you're sharing, if anything, and whether its sound goes too. */
  sharing: { name: string; quality: ShareQuality; sound: boolean } | null
  /** How loud a shared screen's sound is for you (0–2). It plays only while you watch that screen. */
  streamVolume: number
  /** Your own shared screen, for the small preview. */
  localVideo: MediaStream | null
  /** Everyone else's shared-screen pictures, by their id (shown while they're sharing). */
  videos: Record<string, MediaStream>
  /** Your own camera, while it's on. */
  localCamera: MediaStream | null
  /** Everyone else's cameras, by their id (while they're on). */
  cameras: Record<string, MediaStream>
  /** Whose screen you're watching. */
  watching: string | null
}

/** What the engine needs from the app: the Vanity server's voice calls. Each throws with words for the screen. */
export interface VoiceApi {
  start(opts: { private?: boolean; locked?: boolean }): Promise<VoiceUpdate>
  join(roomId: string): Promise<VoiceUpdate>
  leave(): Promise<void>
  update(after: number): Promise<VoiceUpdate>
  state(state: { muted: boolean; deafened: boolean; sharing: boolean; camera: boolean; streams: { screen?: string; camera?: string } }): Promise<void>
  signal(signals: { to: string; data: VoiceSignal }[]): Promise<void>
  setRoom(patch: { private?: boolean; locked?: boolean }): Promise<VoiceUpdate>
  invite(userId: string): Promise<void>
  /** Desktop: the next getDisplayMedia() shares this screen or window. */
  pickScreen(id: string): Promise<boolean>
  /** Desktop (Windows): the sound of a shared screen or window. */
  startScreenAudio(sourceId: string): Promise<ScreenAudioStart>
  stopScreenAudio(): Promise<void>
  onScreenAudio(callback: (pcm: Uint8Array) => void): () => void
  onScreenAudioEnded(callback: () => void): () => void
}

export interface VoiceDeps {
  api: VoiceApi
  settings(): VoiceSettings
  /** Saves someone's volume for you (by their Vanity account id). */
  saveVolume(userId: string, volume: PeerVolume | null): void
  /** Builds the transport (the mesh now; a media server later). */
  transport?: (events: ConstructorParameters<typeof MeshTransport>[0]) => VoiceTransport
}

const TICK_MS = 50
const REMOTE_SPEAKING_DB = -55
/** Checking in: quickly while connections are being set up, calmly otherwise. */
const POLL_BUSY_MS = 250
const POLL_IDLE_MS = 1000
/** Connection details are gathered this long and sent together. */
const SIGNAL_FLUSH_MS = 25

type Peer = VoicePeer & { speaking: boolean; link: PeerLink | null; detector: SpeechDetector }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * The voice engine: one per app. It keeps you in a room on the Vanity server (checking in every
 * second or so, which also brings connection details from the others), owns the audio (through
 * AudioEngine) and the connections to other players (through a VoiceTransport), and tells the
 * screens what's going on through `subscribe`. Nothing in here draws anything.
 */
export class VoiceClient {
  private audio: AudioEngine | null = null
  private transport: VoiceTransport | null = null
  private ice = ''
  /** This visit's id, sent with connection details (an app that restarted has a new one). */
  private session = ''
  /** The visit each other person is on, as their connection details say. */
  private sessions = new Map<string, string>()
  /** Bumped whenever a call ends, so a check-in loop from an earlier call stops. */
  private gen = 0
  private after = 0
  private lastSignalAt = 0
  private serverPing: number | null = null
  private outbox: { to: string; data: VoiceSignal }[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private stateTimer: ReturnType<typeof setTimeout> | null = null
  private lastRoomId: string | null = null
  private me: VoiceUser | null = null
  private myId = ''
  private peers = new Map<string, Peer>()
  private selfDetector = new SpeechDetector(DEFAULT_VOICE.sensitivityDb)
  private pttDown = false
  private pttUntil = 0
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private measureTimer: ReturnType<typeof setInterval> | null = null
  private testing = false
  private gateOpen = false
  private screenTrack: MediaStreamTrack | null = null
  private cameraTrack: MediaStreamTrack | null = null
  /** Every video stream from each person, by stream id; their room state says which is the screen and which the camera. */
  private remoteVideos = new Map<string, Map<string, MediaStream>>()
  /** Stops listening to the shared sound coming from Windows. */
  private screenAudioOff: (() => void) | null = null
  private levelListeners = new Set<(db: number) => void>()
  private listeners = new Set<(s: VoiceSnapshot) => void>()
  private snap: VoiceSnapshot = {
    status: 'idle',
    room: null,
    isHost: false,
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
    attempt: 0,
    sharing: null,
    streamVolume: 1,
    localVideo: null,
    videos: {},
    localCamera: null,
    cameras: {},
    watching: null
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
    return this.snap.status === 'in-room' || this.snap.status === 'reconnecting' || this.snap.status === 'connecting'
  }

  /** Starts a room your friends can see (private: hidden; locked: seen, but invite only). */
  async start(opts: { private?: boolean; locked?: boolean } = {}): Promise<void> {
    await this.begin(null, () => this.deps.api.start(opts))
  }

  /** Joins a friend's room. */
  async join(roomId: string): Promise<void> {
    if (this.snap.room?.id === roomId && this.inRoom) return
    await this.begin(roomId, () => this.deps.api.join(roomId))
  }

  leave(): void {
    const was = this.snap.status === 'in-room' || this.snap.status === 'reconnecting'
    if (this.snap.room) void this.deps.api.leave().catch(() => {})
    this.teardown()
    if (was) this.sound('self-leave')
    this.lastRoomId = null
    this.set({ status: 'idle', room: null, isHost: false, members: [], error: null, notice: null, ping: null, quality: 'unknown', speaking: false, attempt: 0 })
  }

  /** "Try again" after an error, or "Reconnect now" while reconnecting. */
  retry(): void {
    if (this.snap.status === 'reconnecting') {
      this.lastSignalAt = performance.now()
      return
    }
    if (this.lastRoomId) void this.join(this.lastRoomId)
  }

  dismissNotice(): void {
    this.set({ notice: null, error: this.snap.status === 'error' ? this.snap.error : null })
  }

  /** Private and locked (only the host). */
  async setRoom(patch: { private?: boolean; locked?: boolean }): Promise<void> {
    if (!this.snap.room) return
    // Shown at once; the server's answer settles it.
    this.set({ room: { ...this.snap.room, ...patch } })
    try {
      await this.apply(await this.deps.api.setRoom(patch), false)
    } catch (err) {
      this.set({ notice: err instanceof Error ? err.message : 'That could not be changed.' })
    }
  }

  /** Lets a friend in (even when the room is private or locked). */
  async invite(userId: string): Promise<void> {
    await this.deps.api.invite(userId)
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
    this.emitMembers()
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
    this.emitMembers()
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

  // ---- screen sharing ----------------------------------------------------------------

  /**
   * Shares a screen or window (picked in Vanity's picker) with everyone in the room, and its
   * sound when `withSound` (Windows): for a screen, everything you hear except Vanity (so nobody
   * hears themselves back); for a window, only that program's sound.
   */
  async startScreenShare(source: { id: string; name: string }, quality: ShareQuality, withSound = false): Promise<void> {
    if (!this.transport || !this.inRoom) return
    const q = SHARE_QUALITY[quality]
    if (!navigator.mediaDevices?.getDisplayMedia) return this.set({ notice: "Screen sharing isn't available on this device. You can still watch other people's screens." })
    let stream: MediaStream
    try {
      if (!(await this.deps.api.pickScreen(source.id))) throw new Error('not picked')
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.fps, max: q.fps } }, audio: false })
    } catch {
      return this.set({ notice: `"${source.name}" couldn't be shared. It may have closed; pick it again.` })
    }
    const track = stream.getVideoTracks()[0]
    if (!track) return
    // Games and video want smooth motion; documents and code want sharp detail.
    track.contentHint = q.fps >= 60 ? 'motion' : 'detail'
    this.stopScreenTrack()
    this.screenTrack = track
    // The window or screen went away, or Windows stopped it.
    track.onended = () => {
      if (this.screenTrack === track) this.stopScreenShare()
    }
    const sound = withSound ? await this.startSound(source.id) : null
    if (this.screenTrack !== track) return // stopped meanwhile
    this.transport?.setVideo(track, { maxBitrate: q.bitrate, maxFramerate: q.fps, motion: q.fps >= 60 }, sound)
    this.set({ sharing: { name: source.name, quality, sound: !!sound }, localVideo: new MediaStream([track]) })
    this.sound('join')
    this.sendState()
    this.emitMembers()
  }

  /** The shared screen's sound, from Windows, as a track (null when it can't be shared, with a notice saying why). */
  private async startSound(sourceId: string): Promise<MediaStreamTrack | null> {
    if (!this.audio) return null
    const r = await this.deps.api.startScreenAudio(sourceId).catch(() => ({ ok: false as const, reason: 'failed' as const, message: "Sound couldn't be shared." }))
    if (!r.ok) {
      this.set({ notice: `${r.message} Your screen is shared without sound.` })
      return null
    }
    try {
      const track = await this.audio.startPcm()
      const offData = this.deps.api.onScreenAudio((pcm) => this.audio?.pushPcm(pcm))
      const offEnded = this.deps.api.onScreenAudioEnded(() => {
        if (!this.snap.sharing?.sound) return
        this.stopSound()
        this.transport?.setVideo(this.screenTrack, this.encodingNow(), null)
        this.set({ sharing: { ...this.snap.sharing, sound: false }, notice: "The shared window's sound stopped. The picture is still shared." })
      })
      this.screenAudioOff = () => {
        offData()
        offEnded()
      }
      return track
    } catch {
      void this.deps.api.stopScreenAudio().catch(() => {})
      this.set({ notice: "Sound couldn't be shared. Your screen is shared without sound." })
      return null
    }
  }

  private stopSound(): void {
    this.screenAudioOff?.()
    this.screenAudioOff = null
    this.audio?.stopPcm()
    void this.deps.api.stopScreenAudio().catch(() => {})
  }

  private encodingNow(): { maxBitrate: number; maxFramerate: number; motion: boolean } {
    const q = SHARE_QUALITY[this.snap.sharing?.quality ?? 'sharp']
    return { maxBitrate: q.bitrate, maxFramerate: q.fps, motion: q.fps >= 60 }
  }

  stopScreenShare(): void {
    if (!this.screenTrack) return
    this.stopScreenTrack()
    this.transport?.setVideo(null, this.encodingNow(), null)
    this.set({ sharing: null, localVideo: null })
    this.sound('leave')
    this.sendState()
    this.emitMembers()
  }

  /** How loud someone's shared-screen sound is arriving, in dB (−100 when silent or none). */
  streamLevelDb(peerId: string): number {
    return this.audio?.remoteLevelDb(`${peerId}#screen`) ?? -100
  }

  /** How loud shared screens' sound is for you (0–2). */
  setStreamVolume(v: number): void {
    this.set({ streamVolume: Math.min(2, Math.max(0, v)) })
    this.applyStreamVolumes()
  }

  /** A shared screen's sound plays only for the screen you're watching. */
  private applyStreamVolumes(): void {
    for (const id of this.peers.keys()) this.audio?.setRemoteVolume(`${id}#screen`, this.snap.watching === id ? this.snap.streamVolume : 0)
  }

  // ---- camera ----------------------------------------------------------------------

  /** Turns your camera on for everyone in the room. */
  async startCamera(): Promise<void> {
    if (!this.transport || !this.inRoom || this.cameraTrack) return
    if (!navigator.mediaDevices?.getUserMedia) return this.set({ notice: "A camera can't be used on this device." })
    const id = this.deps.settings().cameraDeviceId
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: id ? { ideal: id } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false })
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      return this.set({
        notice:
          name === 'NotAllowedError' || name === 'SecurityError'
            ? "Vanity isn't allowed to use your camera. Allow it in your device's privacy settings (Windows: Settings → Privacy & security → Camera)."
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'No camera was found.'
              : 'Your camera couldn\'t be started. Another app may be using it.'
      })
    }
    const track = stream.getVideoTracks()[0]
    if (!track || !this.transport) return stream.getTracks().forEach((t) => t.stop())
    track.contentHint = 'motion'
    track.onended = () => {
      if (this.cameraTrack === track) this.stopCamera()
    }
    this.cameraTrack = track
    this.transport.setCamera(track)
    this.set({ localCamera: new MediaStream([track]) })
    this.sendState()
    this.emitMembers()
  }

  stopCamera(): void {
    if (!this.cameraTrack) return
    this.stopCameraTrack()
    this.transport?.setCamera(null)
    this.set({ localCamera: null })
    this.sendState()
    this.emitMembers()
  }

  private stopCameraTrack(): void {
    if (!this.cameraTrack) return
    this.cameraTrack.onended = null
    this.cameraTrack.stop()
    this.cameraTrack = null
  }

  /** Splits everyone's videos into shared screens and cameras, by what their room state says. */
  private sortVideos(): void {
    const videos: Record<string, MediaStream> = {}
    const cameras: Record<string, MediaStream> = {}
    for (const [id, streams] of this.remoteVideos) {
      const p = this.peers.get(id)
      if (!p) continue
      const camera = p.streams?.camera ? streams.get(p.streams.camera) : undefined
      const screen = p.streams?.screen ? streams.get(p.streams.screen) : [...streams.entries()].find(([sid]) => sid !== p.streams?.camera)?.[1]
      if (screen) videos[id] = screen
      if (camera && p.camera) cameras[id] = camera
    }
    const same = (a: Record<string, MediaStream>, b: Record<string, MediaStream>): boolean => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v)
    if (!same(videos, this.snap.videos) || !same(cameras, this.snap.cameras)) this.set({ videos, cameras })
  }

  /** Whose shared screen to show big (null: nobody's). */
  watch(peerId: string | null): void {
    this.set({ watching: peerId && this.peers.get(peerId)?.sharing ? peerId : null })
    this.applyStreamVolumes()
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

  /** Into a room: opens the microphone, asks the server, then keeps checking in. */
  private async begin(roomId: string | null, ask: () => Promise<VoiceUpdate>): Promise<void> {
    if (this.inRoom) this.leave()
    if (typeof RTCPeerConnection === 'undefined') return this.fail(new VoiceError('unsupported', "Voice isn't available in this version of the app."))
    const gen = ++this.gen
    this.set({ status: 'connecting', error: null, notice: null, room: roomId ? { id: roomId, hostId: '', private: false, locked: false } : null, isHost: false, members: [], attempt: 0, watching: null, videos: {}, cameras: {} })
    this.lastRoomId = roomId
    await this.ensureAudio()
    this.selfDetector.thresholdDb = this.deps.settings().sensitivityDb
    const micOk = await this.openMic()
    // A fresh call starts unmuted (or muted when there's no microphone to talk with).
    this.set({ muted: !micOk, deafened: false })
    let u: VoiceUpdate
    try {
      u = await ask()
    } catch (err) {
      if (gen !== this.gen) return
      this.teardown()
      const message = err instanceof Error ? err.message : 'Voice rooms are not reachable right now.'
      return this.fail(new VoiceError(/sign in/i.test(message) ? 'signed-out' : /full/i.test(message) ? 'full' : /closed|locked|can't join/i.test(message) ? 'not-found' : 'unreachable', message))
    }
    if (gen !== this.gen) return
    if (!u.room) {
      this.teardown()
      return this.fail(new VoiceError('not-found', 'That voice room has closed.'))
    }
    this.session = newSessionId()
    this.after = 0
    this.myId = u.you
    const make = this.deps.transport ?? ((events) => new MeshTransport(events))
    this.transport = make({
      signal: (to, data) => this.queueSignal(to, data),
      remoteStream: (id, stream) => {
        this.audio?.addRemote(id, stream)
        const p = this.peers.get(id)
        if (p) {
          const v = this.volumeFor(p.user.id)
          this.audio?.setRemoteVolume(id, v.muted ? 0 : v.volume)
        }
      },
      remoteGone: (id) => {
        this.audio?.removeRemote(id)
        this.audio?.removeRemote(`${id}#screen`)
        this.remoteVideos.delete(id)
        this.sortVideos()
      },
      remoteVideo: (id, stream, streamId) => {
        const mine = this.remoteVideos.get(id) ?? new Map<string, MediaStream>()
        mine.set(streamId, stream)
        this.remoteVideos.set(id, mine)
        this.sortVideos()
      },
      remoteScreenAudio: (id, stream) => {
        this.audio?.addRemote(`${id}#screen`, stream)
        this.audio?.setRemoteVolume(`${id}#screen`, this.snap.watching === id ? this.snap.streamVolume : 0)
      },
      link: (id, link) => {
        const p = this.peers.get(id)
        if (!p) return
        p.link = link
        this.emitMembers()
      }
    })
    this.ice = JSON.stringify(u.ice)
    this.transport.start({ myId: u.you, localTrack: this.audio!.sendTrack, iceServers: u.ice })
    this.set({ status: 'in-room', error: null, attempt: 0 })
    await this.apply(u, true)
    this.sound('self-join')
    this.sendState(true)
    this.startTicking()
    this.startMeasuring()
    void this.checkIn(gen)
  }

  /** Checks in until the call ends: quickly while connections are being set up, calmly otherwise. */
  private async checkIn(gen: number): Promise<void> {
    let failures = 0
    while (gen === this.gen) {
      const settingUp = [...this.peers.values()].some((p) => p.connected && p.link?.state !== 'connected')
      const busy = settingUp || performance.now() - this.lastSignalAt < 6000
      await sleep(failures ? Math.min(8000, 1000 * failures) : busy ? POLL_BUSY_MS : POLL_IDLE_MS)
      if (gen !== this.gen) return
      const t0 = performance.now()
      try {
        const u = await this.deps.api.update(this.after)
        if (gen !== this.gen) return
        this.serverPing = Math.round(performance.now() - t0)
        if (failures) {
          failures = 0
          this.set({ status: 'in-room', attempt: 0 })
        }
        await this.apply(u, false)
      } catch (err) {
        if (gen !== this.gen) return
        failures++
        if (err instanceof Error && /sign in/i.test(err.message)) {
          this.teardown()
          return this.fail(new VoiceError('signed-out', 'You were signed out, so you left the voice room. Sign in again to rejoin.'))
        }
        // A blip is normal; after a few in a row, say so (audio between players may still be fine).
        if (failures >= 3) this.set({ status: 'reconnecting', attempt: failures })
      }
    }
  }

  /** The room as the server sees it, and connection details from the others. */
  private async apply(u: VoiceUpdate, first: boolean): Promise<void> {
    const transport = this.transport
    if (!transport) return
    if (!u.room) {
      if (this.snap.room && this.snap.status !== 'idle') {
        // Taken out (no check-in for a long while): try to get back in once.
        const roomId = this.snap.room.id
        const gen = this.gen
        try {
          const again = await this.deps.api.join(roomId)
          if (gen === this.gen && again.room) return this.apply(again, false)
        } catch {
          // Closed, or no longer allowed in.
        }
        if (gen !== this.gen) return
        this.teardown()
        this.set({ status: 'idle', room: null, isHost: false, members: [], notice: 'You lost your connection for too long and left the voice room.', ping: null, quality: 'unknown' })
      }
      return
    }
    const ice = JSON.stringify(u.ice)
    if (ice !== this.ice) {
      this.ice = ice
      transport.setIceServers(u.ice)
    }
    this.myId = u.you
    const others = u.room.members.filter((m) => m.id !== u.you)
    this.me = u.room.members.find((m) => m.id === u.you)?.user ?? this.me
    const ids = new Set(others.map((m) => m.id))
    for (const id of [...this.peers.keys()]) {
      if (ids.has(id)) continue
      this.peers.delete(id)
      this.sessions.delete(id)
      transport.removePeer(id)
      this.sound('leave')
      if (this.snap.watching === id) this.set({ watching: null })
    }
    for (const m of others) {
      const known = this.peers.get(m.id)
      if (known) {
        Object.assign(known, { user: m.user, muted: m.muted, deafened: m.deafened, sharing: m.sharing, camera: m.camera, streams: m.streams, connected: m.connected, joinedAt: m.joinedAt })
        if (!m.sharing && this.snap.watching === m.id) this.set({ watching: null })
      } else {
        this.peers.set(m.id, { ...m, speaking: false, link: null, detector: new SpeechDetector(REMOTE_SPEAKING_DB, 20, 300) })
        transport.addPeer(m.id)
        if (!first) this.sound('join')
      }
    }
    for (const s of u.signals) {
      this.after = Math.max(this.after, s.id)
      this.lastSignalAt = performance.now()
      if (!this.peers.has(s.from)) continue
      const known = this.sessions.get(s.from)
      if (s.data.session && known !== s.data.session) {
        if (known && s.data.kind !== 'offer') continue // left over from before their app restarted
        if (known) transport.resetPeer(s.from) // their app restarted: start over with them
        this.sessions.set(s.from, s.data.session)
      }
      void transport.handleSignal(s.from, s.data)
    }
    this.applyStreamVolumes()
    this.sortVideos()
    const r = u.room
    this.lastRoomId = r.id
    this.set({ room: { id: r.id, hostId: r.hostId, private: r.private, locked: r.locked }, isHost: r.hostId === u.you })
    this.emitMembers()
  }

  private queueSignal(to: string, data: VoiceSignal): void {
    this.outbox.push({ to, data: { ...data, session: this.session } })
    this.lastSignalAt = performance.now()
    if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), SIGNAL_FLUSH_MS)
  }

  private async flush(): Promise<void> {
    this.flushTimer = null
    const gen = this.gen
    while (this.outbox.length && gen === this.gen) {
      const batch = this.outbox.splice(0, 40)
      try {
        await this.deps.api.signal(batch)
      } catch {
        // Once more after a moment; a lost detail is recovered by the connection retrying.
        await sleep(500)
        if (gen === this.gen) await this.deps.api.signal(batch).catch(() => {})
      }
    }
  }

  /** Shares mute, deafen and screen sharing (gathered for a moment, so quick toggles send once). */
  private sendState(now = false): void {
    if (this.stateTimer) clearTimeout(this.stateTimer)
    const send = (): void => {
      this.stateTimer = null
      if (!this.inRoom) return
      void this.deps.api.state({ muted: this.snap.muted, deafened: this.snap.deafened, sharing: !!this.snap.sharing, camera: !!this.cameraTrack, streams: this.transport?.streamIds() ?? {} }).catch(() => {})
    }
    if (now) send()
    else this.stateTimer = setTimeout(send, 150)
  }

  private emitMembers(override: Record<string, PeerVolume> = {}): void {
    const members: VoiceMember[] = []
    const hostId = this.snap.room?.hostId ?? ''
    if (this.me && this.myId && this.snap.status !== 'idle') {
      members.push({
        id: this.myId,
        user: this.me,
        you: true,
        host: hostId === this.myId,
        muted: this.snap.muted,
        deafened: this.snap.deafened,
        sharing: !!this.snap.sharing,
        camera: !!this.cameraTrack,
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
      members.push({ id: p.id, user: p.user, you: false, host: hostId === p.id, muted: p.muted, deafened: p.deafened, sharing: p.sharing, camera: p.camera, connected: p.connected, speaking: p.speaking, volume: v.volume, localMuted: v.muted, link: p.link })
    }
    const links = others.map((p) => p.link).filter((l): l is PeerLink => !!l && l.state === 'connected')
    const rtts = links.map((l) => l.rttMs).filter((r): r is number => r !== null)
    const ping = rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : this.serverPing
    const order: Quality[] = ['poor', 'ok', 'good', 'unknown']
    const worst = links.length ? links.map((l) => l.quality).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] : qualityOf(this.serverPing, null)
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
    const canTalk = (this.snap.status === 'in-room' || this.snap.status === 'reconnecting') && this.snap.micAvailable && !this.snap.muted && !this.snap.deafened
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

  private stopScreenTrack(): void {
    if (this.screenAudioOff || this.snap.sharing?.sound) this.stopSound()
    if (!this.screenTrack) return
    this.screenTrack.onended = null
    this.screenTrack.stop()
    this.screenTrack = null
  }

  private teardown(): void {
    this.gen++
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.stateTimer) clearTimeout(this.stateTimer)
    this.flushTimer = this.stateTimer = null
    this.outbox = []
    this.stopScreenTrack()
    this.transport?.close()
    this.transport = null
    for (const id of this.peers.keys()) this.audio?.removeRemote(id)
    this.peers.clear()
    this.sessions.clear()
    this.myId = ''
    this.after = 0
    this.serverPing = null
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
    this.stopCameraTrack()
    this.remoteVideos.clear()
    this.set({ sharing: null, localVideo: null, videos: {}, cameras: {}, localCamera: null, watching: null })
  }
}
