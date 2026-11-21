// What Vanity and its account server exchange for voice rooms. The server (server/src/voice.ts)
// keeps who is in which room and passes WebRTC connection details between players; the audio
// itself goes directly between their apps (Opus over WebRTC), or through a TURN relay when a
// network doesn't allow a direct connection.
//
// There are no codes: a room belongs to whoever started it, and friends see it and can join,
// unless it is private (hidden; invite only) or locked (seen, but invite only).
//
// This file has no imports, so the app, the server and the tests all share it as-is.

/** People per room. A direct "mesh" (everyone connected to everyone) is good up to about this many. */
export const MAX_ROOM_SIZE = 6

/** Someone counts as dropped (shown as reconnecting) after this long without checking in. */
export const VOICE_STALE_MS = 10_000
/** …and is taken out of the room after this long. */
export const VOICE_GONE_MS = 45_000

/** Who someone is, as their Vanity account shows them. */
export interface VoiceUser {
  id: string
  username: string
  /** Their profile picture (a small data: image), or null. */
  avatar: string | null
  /** Their profile look (banner, frame, name effect, emoji); see src/shared/profileStyle.ts. */
  style: unknown
  verified: boolean
  admin: boolean
}

/** The WebRTC stream ids someone's shared screen and camera travel on. */
export interface VoiceStreams {
  screen?: string
  camera?: string
}

/** One person in a room. Their id is their Vanity account id (one voice room per account). */
export interface VoicePeer {
  id: string
  user: VoiceUser
  muted: boolean
  deafened: boolean
  /** Sharing their screen. */
  sharing: boolean
  /** Their camera is on. */
  camera: boolean
  /** Which of their video streams is which (WebRTC stream ids), so a camera isn't shown as a screen. */
  streams: VoiceStreams
  /** False while their app hasn't checked in for a few seconds (a dropped connection). */
  connected: boolean
  joinedAt: number
  /** Whose shared screen they're watching (an account id), or null. */
  watching?: string | null
}

export interface VoiceRoom {
  id: string
  /** Whoever started it (or took over when they left). Only they change private and locked. */
  hostId: string
  /** Hidden from friends: only people invited can join. */
  private: boolean
  /** Friends can see it, but only people invited can join. */
  locked: boolean
  /** Everyone in it, you included, in the order they joined. */
  members: VoicePeer[]
  /** A call started from a chat: "dm:<id>:<id>" or "group:<id>". Null for a room from the Voice page. */
  chat?: string | null
  /** People this call is still ringing for. */
  ringing?: VoiceUser[]
}

/** STUN finds your public address; TURN relays audio when a direct connection isn't possible. */
export interface VoiceIceServer {
  urls: string[]
  username?: string
  credential?: string
}

/**
 * A WebRTC connection detail passed from one player to another. `session` names the sender's
 * current visit to the room, so details from before their app restarted can be told apart.
 */
export type VoiceSignal = { session?: string } & (
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } }
)

/** What the app gets each time it checks in during a call (and after joining or starting a room). */
export interface VoiceUpdate {
  /** Your own account id (how you appear in `room.members`). */
  you: string
  /** The room you're in, or null if you're not in one (left, or taken out after a long drop). */
  room: VoiceRoom | null
  /** Connection details for you, oldest first. Pass the last id back as `after` next time. */
  signals: { id: number; from: string; data: VoiceSignal }[]
  ice: VoiceIceServer[]
}

/** A friend's voice room, as the friends list shows it (only rooms you're allowed to see). */
export interface FriendVoice {
  roomId: string
  /** People in it. */
  count: number
  /** Their first few names, for "In voice with …". */
  names: string[]
  locked: boolean
  /** Someone in it is sharing their screen. */
  live: boolean
  /** False when it's locked, or full, and you weren't invited. */
  canJoin: boolean
}

/** How long a call rings before it is given up on. */
export const RING_MS = 40_000

/** A call ringing for you (from the quick check-in). */
export interface IncomingCall {
  roomId: string
  from: VoiceUser
  /** The group chat it is for, or null for a call from one friend. */
  group: { id: string; name: string } | null
  at: number | null
}

/** The chat a direct call between two accounts belongs to. */
export const dmChat = (a: string, b: string): string => `dm:${[a, b].sort().join(':')}`

/** Connection details sent in one go (the app gathers them for a moment rather than sending each). */
export const MAX_SIGNALS_PER_SEND = 40

/** Largest offer or answer accepted (they are a few kilobytes). */
export const MAX_SDP = 40_000
