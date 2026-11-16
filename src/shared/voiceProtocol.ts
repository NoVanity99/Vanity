// The messages Vanity and its voice signaling server (server/voice) send each other over a
// WebSocket, as JSON. The server only introduces people and passes their connection details
// along; the audio itself goes directly between players (WebRTC, Opus), or through a TURN relay
// when a network doesn't allow a direct connection.
//
// This file has no imports, so the app, the server and the tests all share it as-is.

/** Bumped when the messages change in a way older copies can't understand. */
export const VOICE_PROTOCOL = 1

/** People per room. A direct "mesh" (everyone connected to everyone) is good up to about this many. */
export const MAX_ROOM_SIZE = 6

/** Invite codes: six letters and digits, leaving out ones that are easy to mix up (0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/

/** Turns what someone typed ("abc 234", "ABC-234", " abc234 ") into a code, or null if it can't be one. */
export function normalizeRoomCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '')
  return ROOM_CODE.test(code) ? code : null
}

/** Who someone is, as their Vanity account shows them. */
export interface VoiceUser {
  /** The Vanity account id (or "guest:…" on a server run without accounts, for testing). */
  id: string
  username: string
  /** Their profile picture (a small data: image), or null. */
  avatar: string | null
  /** Their profile look (banner, frame, name effect, emoji); see src/shared/profileStyle.ts. */
  style: unknown
  verified: boolean
  admin: boolean
}

/** One person in a room. `id` is this visit's id (a new one each time someone joins). */
export interface VoicePeer {
  id: string
  user: VoiceUser
  muted: boolean
  deafened: boolean
  /** False for a few seconds while their connection drops and comes back. */
  connected: boolean
  joinedAt: number
}

/** STUN finds your public address; TURN relays audio when a direct connection isn't possible. */
export interface VoiceIceServer {
  urls: string[]
  username?: string
  credential?: string
}

/** A WebRTC connection detail passed from one player to another. */
export type VoiceSignal =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } }

export type VoiceClientMessage =
  /** First message: who you are. `token` is your Vanity sign-in token. */
  | { t: 'hello'; v: number; token?: string; guest?: string }
  /** Make a room. `session` is a random id the app makes for this visit; sending it again resumes after a dropped connection. */
  | { t: 'create'; session: string }
  /**
   * `resume`: coming back after a dropped connection. If the room is gone (the server restarted),
   * it is made again under the same code, so everyone who comes back finds each other.
   */
  | { t: 'join'; code: string; session: string; resume?: boolean }
  | { t: 'leave' }
  | { t: 'signal'; to: string; data: VoiceSignal }
  | { t: 'state'; muted: boolean; deafened: boolean }
  | { t: 'ping'; at: number }

export type VoiceErrorCode =
  /** Not signed in, or the sign-in couldn't be checked. */
  | 'auth'
  /** No room has that code (it was never made, or everyone left). */
  | 'not-found'
  | 'full'
  | 'bad-request'
  | 'rate'
  /** This copy of Vanity is too old (or too new) for the server. */
  | 'version'
  /** You joined voice somewhere else (another device or window). */
  | 'replaced'
  | 'server'

export type VoiceServerMessage =
  | { t: 'welcome'; you: VoiceUser; ice: VoiceIceServer[] }
  /** You're in a room: everyone else in it, and your own id there. */
  | { t: 'room'; code: string; you: string; peers: VoicePeer[]; resumed: boolean }
  | { t: 'peer-joined'; peer: VoicePeer }
  | { t: 'peer-left'; id: string }
  | { t: 'peer-state'; id: string; muted: boolean; deafened: boolean; connected: boolean }
  | { t: 'signal'; from: string; data: VoiceSignal }
  | { t: 'pong'; at: number }
  | { t: 'error'; code: VoiceErrorCode; message: string }

/** Largest message either side sends (offers and answers are a few kilobytes; a profile picture up to ~60 KB). */
export const MAX_MESSAGE_BYTES = 256 * 1024
