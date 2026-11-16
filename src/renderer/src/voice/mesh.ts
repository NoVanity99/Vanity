import type { VoiceIceServer, VoiceSignal } from '@shared/voiceProtocol'
import { qualityOf, tuneOpus } from './detect'
import type { PeerLink, TransportEvents, VoiceTransport } from './transport'

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
  /** Sends the shared screen, once one has been shared. */
  video: RTCRtpSender | null
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
  private video: { track: MediaStreamTrack; stream: MediaStream; encoding: { maxBitrate: number; maxFramerate: number } } | null = null

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

  setVideo(track: MediaStreamTrack | null, encoding: { maxBitrate: number; maxFramerate: number }): void {
    this.video = track ? { track, stream: new MediaStream([track]), encoding } : null
    for (const c of this.conns.values()) this.applyVideo(c)
  }

  /**
   * The shared screen goes on its own video line. Stopping only takes the picture off it (no
   * renegotiation), so sharing again later is instant; whether someone is sharing comes from
   * the room's state, not from the line.
   */
  private applyVideo(c: Conn): void {
    const v = this.video
    if (!v) {
      if (c.video) void c.video.replaceTrack(null).catch(() => {})
      return
    }
    if (c.video) {
      void c.video.replaceTrack(v.track).catch(() => {})
      const p = c.video.getParameters()
      if (p.encodings?.length) {
        p.encodings[0].maxBitrate = v.encoding.maxBitrate
        p.encodings[0].maxFramerate = v.encoding.maxFramerate
        void c.video.setParameters(p).catch(() => {})
      }
      return
    }
    const t = c.pc.addTransceiver(v.track, { direction: 'sendonly', streams: [v.stream], sendEncodings: [{ maxBitrate: v.encoding.maxBitrate, maxFramerate: v.encoding.maxFramerate, priority: 'low', networkPriority: 'low' }] })
    c.video = t.sender
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
    const pc = new RTCPeerConnection({ iceServers: this.ice, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' })
    const c: Conn = {
      pc,
      polite: this.myId > peerId,
      makingOffer: false,
      ignoreOffer: false,
      pending: [],
      link: { state: 'connecting', rttMs: null, loss: null, quality: 'unknown' },
      lastPackets: null,
      restartTimer: null,
      video: null
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
      if (e.track.kind === 'video') return this.events.remoteVideo(peerId, new MediaStream([e.track]))
      this.events.remoteStream(peerId, e.streams[0] ?? new MediaStream([e.track]))
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
