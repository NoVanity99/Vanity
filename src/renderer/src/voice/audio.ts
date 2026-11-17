import type { VoiceSettings } from '@shared/voiceSettings'
import { levelDb } from './detect'
import { micError } from './errors'

export type VoiceSound = 'join' | 'leave' | 'self-join' | 'self-leave' | 'mute' | 'unmute' | 'deafen' | 'undeafen'

interface RemoteAudio {
  /**
   * Plays the person's voice. A plain audio element is the path the echo canceller on THEIR side
   * knows about, so your voice coming out of their speakers is taken out of their microphone
   * before it's sent back to you. (Sound played through Web Audio isn't reliably known to it,
   * which is how people heard themselves.)
   */
  element: HTMLAudioElement
  /** For the talking ring only: measured, never played. */
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  /** Only for volumes above 100%, which an audio element can't reach: then Web Audio plays it instead. */
  gain: GainNode
  /** Their volume for you (0–2). */
  volume: number
}

type MicConstraints = Pick<VoiceSettings, 'inputDeviceId' | 'noiseSuppression' | 'echoCancellation' | 'autoGainControl'>

/**
 * Everything you hear and say, as a Web Audio graph:
 *
 *   microphone → input volume → level meter → gate (open while you talk) → sent to the others
 *   each person → level meter → their volume (0–200%) → output volume / deafen → speakers
 *
 * The track that is sent never changes, even when the microphone does (another device picked,
 * one unplugged), so connections don't need renegotiating.
 */
export class AudioEngine {
  readonly ctx: AudioContext
  private master: GainNode
  private effects: GainNode
  private inputGain: GainNode
  private inputAnalyser: AnalyserNode
  private gate: GainNode
  private monitor: GainNode
  private sendDest: MediaStreamAudioDestinationNode
  private mic: { stream: MediaStream; source: MediaStreamAudioSourceNode; constraints: MicConstraints } | null = null
  private remotes = new Map<string, RemoteAudio>()
  /** The sound of your shared screen, from Windows, on its way to the others. */
  private pcm: { node: AudioWorkletNode; dest: MediaStreamAudioDestinationNode } | null = null
  private workletLoaded: Promise<void> | null = null
  private buf = new Float32Array(1024)
  private outputDevice = ''
  private outputVolume = 1
  private deafened = false
  /** Called when the microphone stops by itself (unplugged, or taken by Windows). */
  onMicEnded: (() => void) | null = null

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 })
    this.master = this.ctx.createGain()
    this.master.connect(this.ctx.destination)
    // Sounds go straight to the speakers, at a fixed gentle level.
    this.effects = this.ctx.createGain()
    this.effects.gain.value = 0.35
    this.effects.connect(this.ctx.destination)
    this.inputGain = this.ctx.createGain()
    this.inputAnalyser = this.ctx.createAnalyser()
    this.inputAnalyser.fftSize = 1024
    this.gate = this.ctx.createGain()
    this.gate.gain.value = 0
    this.monitor = this.ctx.createGain()
    this.monitor.gain.value = 0
    this.sendDest = this.ctx.createMediaStreamDestination()
    this.inputGain.connect(this.inputAnalyser)
    this.inputGain.connect(this.gate)
    this.gate.connect(this.sendDest)
    this.inputGain.connect(this.monitor)
    this.monitor.connect(this.master)
  }

  /**
   * Starts the track that carries your shared screen's sound (stereo). Feed it with `pushPcm`.
   * The player (public/voice-pcm-worklet.js) keeps only 20–100 ms in hand, so it stays in step.
   */
  async startPcm(): Promise<MediaStreamTrack> {
    this.stopPcm()
    this.workletLoaded ??= this.ctx.audioWorklet.addModule(new URL('voice-pcm-worklet.js', document.baseURI).href)
    await this.workletLoaded
    await this.resume()
    const node = new AudioWorkletNode(this.ctx, 'vanity-pcm-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
    const dest = this.ctx.createMediaStreamDestination()
    dest.channelCount = 2
    node.connect(dest)
    this.pcm = { node, dest }
    return dest.stream.getAudioTracks()[0]
  }

  /** 16-bit stereo PCM at 48 kHz, as it arrives. */
  pushPcm(pcm: Uint8Array): void {
    if (!this.pcm) return
    const copy = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer
    this.pcm.node.port.postMessage(copy, [copy])
  }

  stopPcm(): void {
    if (!this.pcm) return
    this.pcm.node.disconnect()
    this.pcm.dest.stream.getTracks().forEach((t) => t.stop())
    this.pcm = null
  }

  /** The audio sent to everyone in the room. */
  get sendTrack(): MediaStreamTrack {
    return this.sendDest.stream.getAudioTracks()[0]
  }

  get hasMic(): boolean {
    return !!this.mic
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {})
  }

  /** Opens (or swaps) the microphone. Throws a VoiceError with plain words when it can't. */
  async openMic(c: MicConstraints): Promise<void> {
    await this.resume()
    const same = this.mic && JSON.stringify(this.mic.constraints) === JSON.stringify(c) && this.mic.stream.getAudioTracks()[0]?.readyState === 'live'
    if (same) return
    const audio: MediaTrackConstraints = {
      deviceId: c.inputDeviceId ? { exact: c.inputDeviceId } : undefined,
      noiseSuppression: c.noiseSuppression,
      echoCancellation: c.echoCancellation,
      autoGainControl: c.autoGainControl,
      channelCount: 1,
      sampleRate: 48000
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
    } catch (err) {
      // The chosen microphone is gone: fall back to the default one rather than failing.
      if (c.inputDeviceId && err instanceof DOMException && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        return this.openMic({ ...c, inputDeviceId: '' })
      }
      throw micError(err)
    }
    this.closeMic()
    const source = this.ctx.createMediaStreamSource(stream)
    source.connect(this.inputGain)
    this.mic = { stream, source, constraints: c }
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (this.mic?.stream === stream) {
        this.closeMic()
        this.onMicEnded?.()
      }
    })
  }

  /** The microphone actually in use ('' when it's the system default, or none). */
  get micDeviceId(): string {
    return this.mic?.stream.getAudioTracks()[0]?.getSettings().deviceId ?? ''
  }

  closeMic(): void {
    if (!this.mic) return
    this.mic.source.disconnect()
    for (const t of this.mic.stream.getTracks()) t.stop()
    this.mic = null
  }

  setInputVolume(v: number): void {
    this.inputGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
  }

  /** Open while you're talking (and not muted); closed otherwise. Short fades avoid clicks. */
  setGate(open: boolean): void {
    this.gate.gain.setTargetAtTime(open ? 1 : 0, this.ctx.currentTime, open ? 0.005 : 0.03)
  }

  /** Hear yourself (the mic test). */
  setMonitor(on: boolean): void {
    this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02)
  }

  /** How loud your microphone is right now, in dB (after your input volume). */
  inputLevelDb(): number {
    if (!this.mic) return -100
    this.inputAnalyser.getFloatTimeDomainData(this.buf)
    return levelDb(this.buf)
  }

  addRemote(id: string, stream: MediaStream): void {
    this.removeRemote(id)
    const element = new Audio()
    element.autoplay = true
    element.srcObject = stream
    const sink = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
    if (this.outputDevice && sink.setSinkId) void sink.setSinkId(this.outputDevice).catch(() => {})
    void element.play().catch(() => {})
    const source = this.ctx.createMediaStreamSource(stream)
    const analyser = this.ctx.createAnalyser()
    analyser.fftSize = 1024
    const gain = this.ctx.createGain()
    gain.gain.value = 0
    source.connect(analyser)
    source.connect(gain)
    gain.connect(this.master)
    const r: RemoteAudio = { element, source, analyser, gain, volume: 1 }
    this.remotes.set(id, r)
    this.applyRemote(r)
  }

  /**
   * Up to 100% (after the output volume), the audio element plays it, echo-cancellable. Above
   * that, Web Audio plays it boosted and the element is silenced.
   */
  private applyRemote(r: RemoteAudio): void {
    const level = this.deafened ? 0 : r.volume * this.outputVolume
    const boosted = level > 1
    r.element.muted = boosted || level === 0
    r.element.volume = Math.min(1, Math.max(0, level))
    // The master gain carries the output volume and deafen for this path.
    r.gain.gain.setTargetAtTime(boosted ? r.volume : 0, this.ctx.currentTime, 0.02)
  }

  removeRemote(id: string): void {
    const r = this.remotes.get(id)
    if (!r) return
    r.source.disconnect()
    r.gain.disconnect()
    r.element.pause()
    r.element.srcObject = null
    this.remotes.delete(id)
  }

  /** 0 to 2 (0–200%). */
  setRemoteVolume(id: string, v: number): void {
    const r = this.remotes.get(id)
    if (!r) return
    r.volume = Math.min(2, Math.max(0, v))
    this.applyRemote(r)
  }

  remoteLevelDb(id: string): number {
    const r = this.remotes.get(id)
    if (!r) return -100
    r.analyser.getFloatTimeDomainData(this.buf)
    return levelDb(this.buf)
  }

  /** Everything you hear: the output volume, or silence while deafened. */
  setOutput(volume: number, deafened: boolean): void {
    this.outputVolume = volume
    this.deafened = deafened
    this.master.gain.setTargetAtTime(deafened ? 0 : volume, this.ctx.currentTime, 0.02)
    for (const r of this.remotes.values()) this.applyRemote(r)
  }

  /** Sends sound to a chosen speaker or headset ('' = the system default). Falls back to the default if it's gone. */
  async setOutputDevice(deviceId: string): Promise<boolean> {
    if (deviceId === this.outputDevice) return true
    const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    if (!ctx.setSinkId) return false
    try {
      await ctx.setSinkId(deviceId)
      this.outputDevice = deviceId
      // The voices play through their own elements: send those there too.
      for (const r of this.remotes.values()) {
        const el = r.element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
        await el.setSinkId?.(deviceId).catch(() => {})
      }
      return true
    } catch {
      if (deviceId) await ctx.setSinkId('').catch(() => {})
      this.outputDevice = ''
      return false
    }
  }

  /** Short tones made on the spot (no recordings): rising for joining, falling for leaving. */
  play(sound: VoiceSound): void {
    if (this.ctx.state !== 'running') return
    const notes: Record<VoiceSound, [number, number][]> = {
      join: [[660, 0], [880, 0.09]],
      leave: [[700, 0], [520, 0.09]],
      'self-join': [[523, 0], [659, 0.08], [784, 0.16]],
      'self-leave': [[784, 0], [659, 0.08], [523, 0.16]],
      mute: [[440, 0]],
      unmute: [[620, 0]],
      deafen: [[392, 0], [330, 0.08]],
      undeafen: [[440, 0], [554, 0.08]]
    }
    const t0 = this.ctx.currentTime + 0.01
    for (const [freq, at] of notes[sound]) {
      const osc = this.ctx.createOscillator()
      const env = this.ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      env.gain.setValueAtTime(0, t0 + at)
      env.gain.linearRampToValueAtTime(1, t0 + at + 0.012)
      env.gain.exponentialRampToValueAtTime(0.001, t0 + at + 0.16)
      osc.connect(env)
      env.connect(this.effects)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.18)
    }
  }

  async close(): Promise<void> {
    this.closeMic()
    for (const id of [...this.remotes.keys()]) this.removeRemote(id)
    await this.ctx.close().catch(() => {})
  }
}

/** Microphones and speakers, by name. Names are only known once microphone access has been given. */
export interface AudioDevices {
  inputs: { id: string; label: string }[]
  outputs: { id: string; label: string }[]
  cameras: { id: string; label: string }[]
  /** False when picking a speaker isn't possible here (some phones). */
  canPickOutput: boolean
}

export async function listDevices(): Promise<AudioDevices> {
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
  const named = (kind: MediaDeviceKind, word: string) =>
    all
      .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${word} ${i + 1}` }))
  return { inputs: named('audioinput', 'Microphone'), outputs: named('audiooutput', 'Speakers'), cameras: named('videoinput', 'Camera'), canPickOutput: 'setSinkId' in AudioContext.prototype }
}
