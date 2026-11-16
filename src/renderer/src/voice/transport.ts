import type { VoiceIceServer, VoiceSignal } from '@shared/voiceProtocol'
import type { Quality } from './detect'

/** How a connection to one person is doing. */
export interface PeerLink {
  state: 'connecting' | 'connected' | 'reconnecting' | 'failed'
  /** Round trip to them (ms). */
  rttMs: number | null
  /** Share of their audio packets lost recently (0–1). */
  loss: number | null
  quality: Quality
}

export interface TransportEvents {
  /** Send connection details to someone (through the signaling server). */
  signal(to: string, data: VoiceSignal): void
  /** Someone's audio arrived (or arrived again after a reconnect). */
  remoteStream(peerId: string, stream: MediaStream): void
  remoteGone(peerId: string): void
  link(peerId: string, link: PeerLink): void
}

/**
 * How audio gets between people in a room. The voice client only ever talks to this, so the
 * peer-to-peer mesh used now (everyone connected to everyone, fine for small rooms) can later be
 * swapped for a media server (an SFU such as LiveKit or mediasoup) without changing the screens.
 *
 * An SFU version would connect once to the media server in `start`, publish `localTrack`, and
 * report each subscribed person through the same events; `addPeer`/`removePeer` would just follow
 * who is in the room, and `signal` would carry its own messages (or go unused).
 */
export interface VoiceTransport {
  start(opts: { myId: string; localTrack: MediaStreamTrack; iceServers: VoiceIceServer[] }): void
  /** Someone is in the room: connect to them. */
  addPeer(peerId: string): void
  removePeer(peerId: string): void
  /** Their connection is broken (they reconnected to the server): start it again from scratch. */
  resetPeer(peerId: string): void
  handleSignal(from: string, data: VoiceSignal): void
  /** New TURN logins after a reconnect to the server. */
  setIceServers(servers: VoiceIceServer[]): void
  /** Ask each connection how it's doing (called every couple of seconds). */
  measure(): Promise<void>
  close(): void
}
