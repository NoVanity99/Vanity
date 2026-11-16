import type { VoiceIceServer, VoiceSignal } from '@shared/voiceProtocol'
import { qualityOf, tuneOpus } from './detect'
import type { PeerLink, TransportEvents, VideoEncoding, VoiceTransport } from './transport'

interface Conn {
  pc: RTCPeerConnection
  /** In "perfect negotiation", the polite side gives way when both start at once. */
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  /** Candidates that arrived before the other side's description. */
  pending: RTCIceCandidateInit[]
  link: PeerLink
  /** For packet loss between two measurements. */
  lastPackets: { received: number; lost: number } | null
  restartTimer: ReturnType<typeof setTimeout> | null
  /** Send the shared screen and its sound, once one has been shared. */
  video: RTCRtpSender | null
  screenAudio: RTCRtpSender | null
  /** Their shared screen's stream id: audio on it is screen sound, not their voice. */
  screenIds: Set<string>
}

/**
 * Peer-to-peer audio: one WebRTC connection to each other person. Both sides can start
 * negotiating at any time (joining, an ICE restart after a network change); clashes are settled
 * the standard "perfect negotiation" way, with the side that has the larger id giving way.
 */
export class MeshTransport implements VoiceTransport {
  private conns = new Map<string, Conn>()
  private myId = ''
  private track: MediaStreamTrack | null = null
  private ice: VoiceIceServer[] = []
  private video: { track: MediaStreamTrack; audio: MediaStreamTrack | null; encoding: VideoEncoding } | null = null
  /** One stream id for everything you share, kept for the whole call, so the others can tell screen sound from voice. */
  private screenStream = new MediaStream()

  constructor(private events: TransportEvents) {}

  start({ myId, localTrack, iceServers }: { myId: string; localTrack: MediaStreamTrack; iceServers: VoiceIceServer[] }): void {
    this.myId = myId
    this.track = localTrack
    this.ice = iceServers
  }

  setIceServers(servers: VoiceIceServer[]): void {
    this.ice = servers
    for (const c of this.conns.values()) {
      try {
        c.pc.setConfiguration({ ...c.pc.getConfiguration(), iceServers: servers })
      } catch {
        // Older connection: it keeps its servers.
      }
    }
  }

  setVideo(track: MediaStreamTrack | null, encoding: VideoEncoding, audio: MediaStreamTrack | null = null): void {
    this.video = track ? { track, audio, encoding } : null
    for (const c of this.conns.values()) this.applyVideo(c)
  }

  /**
   * The shared screen goes on its own video line, and its sound on its own audio line (added
   * together, the first time). Stopping only takes them off the lines (no renegotiation), so
   * sharing again later is instant; whether someone is sharing comes from the room's state.
   */
  private applyVideo(c: Conn): void {
    const v = this.video
    if (!v) {
      if (c.video) void c.video.replaceTrack(null).catch(() => {})
      if (c.screenAudio) void c.screenAudio.replaceTrack(null).catch(() => {})
      return
    }
    if (!c.video) {
      const t = c.pc.addTransceiver(v.track, {
        direction: 'sendonly',
        streams: [this.screenStream],
        sendEncodings: [{ maxBitrate: v.encoding.maxBitrate, maxFramerate: v.encoding.maxFramerate, priority: 'low', networkPriority: 'low' }]
      })
      preferFastVideoCodecs(t)
      c.video = t.sender
      // Its sound, on a line of its own (empty until there's sound to send).
      const a = c.pc.addTransceiver(v.audio ?? 'audio', { direction: 'sendonly', streams: [this.screenStream], sendEncodings: [{ maxBitrate: 128_000, priority: 'medium', networkPriority: 'medium' }] })
      c.screenAudio = a.sender
    } else {
      void c.video.replaceTrack(v.track).catch(() => {})
      void c.screenAudio?.replaceTrack(v.audio).catch(() => {})
    }
    tuneVideoSender(c.video, v.encoding)
  }

  addPeer(peerId: string): void {
    if (this.conns.has(peerId) || peerId === this.myId) return
    this.create(peerId)
  }

  resetPeer(peerId: string): void {
    this.removePeer(peerId)
    this.create(peerId)
  }

  removePeer(peerId: string): void {
    const c = this.conns.get(peerId)
    if (!c) return
    if (c.restartTimer) clearTimeout(c.restartTimer)
    this.conns.delete(peerId)
    c.pc.ontrack = c.pc.onicecandidate = c.pc.onnegotiationneeded = c.pc.onconnectionstatechange = null
    c.pc.close()
    this.events.remoteGone(peerId)
  }

  private create(peerId: string): Conn {
    // A few network candidates gathered up front, so connecting starts sooner.
    const pc = new RTCPeerConnection({ iceServers: this.ice, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require', iceCandidatePoolSize: 2 })
    const c: Conn = {
      pc,
      polite: this.myId > peerId,
      makingOffer: false,
      ignoreOffer: false,
      pending: [],
      link: { state: 'connecting', rttMs: null, loss: null, quality: 'unknown' },
      lastPackets: null,
      restartTimer: null,
      video: null,
      screenAudio: null,
      screenIds: new Set()
    }
    this.conns.set(peerId, c)

    if (this.track) {
      const sender = pc.addTrack(this.track, new MediaStream([this.track]))
      // Voice gets priority on a busy connection, and stays under 64 kbit/s.
      const p = sender.getParameters()
      p.encodings = p.encodings?.length ? p.encodings : [{}]
      p.encodings[0].maxBitrate = 64_000
      p.encodings[0].priority = 'high'
      p.encodings[0].networkPriority = 'high'
      void sender.setParameters(p).catch(() => {})
    } else {
      // No microphone: still receive.
      pc.addTransceiver('audio', { direction: 'recvonly' })
    }

    if (this.video) this.applyVideo(c)

    pc.ontrack = (e) => {
      const stream = e.streams[0]
      // Shown and played as soon as it arrives: no extra buffering beyond what the network needs.
      lowLatency(e.receiver)
      if (e.track.kind === 'video') {
        if (stream) c.screenIds.add(stream.id)
        return this.events.remoteVideo(peerId, new MediaStream([e.track]))
      }
      // The video line comes first, so its stream is already known when the sound arrives.
      if (stream && (c.screenIds.has(stream.id) || stream.getVideoTracks().length > 0)) return this.events.remoteScreenAudio(peerId, new MediaStream([e.track]))
      this.events.remoteStream(peerId, stream ?? new MediaStream([e.track]))
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) this.events.signal(peerId, { kind: 'ice', candidate: { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } })
    }
    pc.onnegotiationneeded = async () => {
      try {
        c.makingOffer = true
        const offer = await pc.createOffer()
        if (pc.signalingState !== 'stable') return
        await pc.setLocalDescription({ type: 'offer', sdp: tuneOpus(offer.sdp ?? '') })
        if (pc.localDescription) this.events.signal(peerId, { kind: 'offer', sdp: pc.localDescription.sdp })
      } catch {
        // A clash with their offer: settled when it arrives.
      } finally {
        c.makingOffer = false
      }
    }
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      if (s === 'connected') {
        if (c.restartTimer) clearTimeout(c.restartTimer)
        c.restartTimer = null
        this.setLink(peerId, c, { state: 'connected' })
      } else if (s === 'disconnected') {
        // Often comes back by itself (a Wi-Fi hiccup); if not, the network path is renegotiated.
        this.setLink(peerId, c, { state: 'reconnecting' })
        if (!c.restartTimer) c.restartTimer = setTimeout(() => this.restartIce(c), 4000)
      } else if (s === 'failed') {
        this.setLink(peerId, c, { state: 'reconnecting' })
        this.restartIce(c)
      }
    }
    return c
  }

  private restartIce(c: Conn): void {
    if (c.restartTimer) clearTimeout(c.restartTimer)
    c.restartTimer = null
    if (c.pc.connectionState === 'connected' || c.pc.connectionState === 'closed') return
    // Only one side restarts, or both would clash: the impolite one.
    if (!c.polite) c.pc.restartIce()
  }

  private setLink(peerId: string, c: Conn, patch: Partial<PeerLink>): void {
    c.link = { ...c.link, ...patch }
    this.events.link(peerId, c.link)
  }

  async handleSignal(from: string, data: VoiceSignal): Promise<void> {
    const c = this.conns.get(from) ?? this.create(from)
    const { pc } = c
    try {
      if (data.kind === 'offer' || data.kind === 'answer') {
        const collision = data.kind === 'offer' && (c.makingOffer || pc.signalingState !== 'stable')
        c.ignoreOffer = !c.polite && collision
        if (c.ignoreOffer) return
        await pc.setRemoteDescription({ type: data.kind, sdp: data.sdp })
        for (const cand of c.pending.splice(0)) await pc.addIceCandidate(cand).catch(() => {})
        if (data.kind === 'offer') {
          const answer = await pc.createAnswer()
          await pc.setLocalDescription({ type: 'answer', sdp: tuneOpus(answer.sdp ?? '') })
          if (pc.localDescription) this.events.signal(from, { kind: 'answer', sdp: pc.localDescription.sdp })
        }
      } else if (data.kind === 'ice') {
        if (!pc.remoteDescription) {
          c.pending.push(data.candidate)
          return
        }
        await pc.addIceCandidate(data.candidate).catch((err) => {
          if (!c.ignoreOffer) throw err
        })
      }
    } catch (err) {
      console.warn('[voice] negotiation with', from, 'failed:', err)
    }
  }

  async measure(): Promise<void> {
    await Promise.all(
      [...this.conns.entries()].map(async ([peerId, c]) => {
        if (c.pc.connectionState !== 'connected') return
        try {
          const stats = await c.pc.getStats()
          let rtt: number | null = null
          let received = 0
          let lost = 0
          stats.forEach((s) => {
            if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected) && typeof s.currentRoundTripTime === 'number') rtt = Math.round(s.currentRoundTripTime * 1000)
            if (s.type === 'inbound-rtp' && s.kind === 'audio') {
              received += s.packetsReceived ?? 0
              lost += Math.max(0, s.packetsLost ?? 0)
            }
          })
          let loss: number | null = null
          if (c.lastPackets) {
            const dr = received - c.lastPackets.received
            const dl = lost - c.lastPackets.lost
            loss = dr + dl > 0 ? Math.max(0, dl) / (dr + dl) : 0
          }
          c.lastPackets = { received, lost }
          this.setLink(peerId, c, { rttMs: rtt, loss, quality: qualityOf(rtt, loss) })
        } catch {
          // Closed meanwhile.
        }
      })
    )
  }

  close(): void {
    for (const id of [...this.conns.keys()]) this.removePeer(id)
  }
}

/**
 * Prefers H.264 for shared screens: Windows PCs (and phones) encode and decode it on the graphics
 * card, which is faster and lighter than the alternatives, so less delay and fewer dropped frames.
 * VP8 stays as the fallback for anything that can't do H.264.
 */
function preferFastVideoCodecs(t: RTCRtpTransceiver): void {
  try {
    const caps = RTCRtpSender.getCapabilities?.('video')?.codecs
    if (!caps?.length || !t.setCodecPreferences) return
    const rank = (c: { mimeType: string }): number => (/h264/i.test(c.mimeType) ? 0 : /vp8/i.test(c.mimeType) ? 1 : /vp9|av1/i.test(c.mimeType) ? 2 : 3)
    t.setCodecPreferences([...caps].sort((a, b) => rank(a) - rank(b)))
  } catch {
    // Keep the browser's own order.
  }
}

/** Bitrate, frame rate, and what to give up first when the connection is busy. */
function tuneVideoSender(sender: RTCRtpSender, e: VideoEncoding): void {
  try {
    const p = sender.getParameters()
    if (p.encodings?.length) {
      p.encodings[0].maxBitrate = e.maxBitrate
      p.encodings[0].maxFramerate = e.maxFramerate
    }
    ;(p as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = e.motion ? 'maintain-framerate' : 'maintain-resolution'
    void sender.setParameters(p).catch(() => {})
  } catch {
    // Not negotiated yet: the values given when the line was added apply.
  }
}

/** Asks for the smallest playback delay the network allows (Chromium's jitter buffer target). */
function lowLatency(receiver: RTCRtpReceiver): void {
  try {
    ;(receiver as RTCRtpReceiver & { jitterBufferTarget?: number | null }).jitterBufferTarget = 0
  } catch {
    // Not supported here.
  }
}
