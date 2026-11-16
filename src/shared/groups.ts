// Group chats and GIFs, shared by the app and the Vanity server (server/src/groups.ts).
// This file has no imports, so both sides can use it as-is.

/** People in one group chat, you included. */
export const MAX_GROUP_SIZE = 20
export const MAX_GROUP_NAME = 40

/** A GIF uploaded from your PC or phone: at most this big (bytes). */
export const MAX_GIF_BYTES = 3 * 1024 * 1024

export interface GroupMember {
  id: string
  username: string
  avatar: string | null
  style: unknown
  verified: boolean
  admin: boolean
}

export interface GroupChat {
  id: string
  name: string
  /** Who made it (or took over when they left). They can remove people. */
  ownerId: string
  members: GroupMember[]
  /** Messages you haven't read yet. */
  unread: number
  lastMessage: { id: number; text: string; at: number | null; senderId: string; senderName: string } | null
}

export interface GroupMessage {
  id: number
  senderId: string
  text: string
  at: number | null
}

export interface GroupPage {
  messages: GroupMessage[]
  /** There are older messages than these. */
  hasMore: boolean
}

/** One GIF from the search (KLIPY), ready to show and send. */
export interface GifResult {
  id: string
  /** The GIF to send (and show big). */
  url: string
  /** A smaller copy for the picker. */
  preview: string
  width: number
  height: number
}

/**
 * How a GIF travels inside a message: "[gif] " and where it is, either a KLIPY address or
 * "media:<id>" for one uploaded to Vanity's server. Any other text is a normal message.
 */
const GIF_PREFIX = '[gif] '
const KLIPY_URL = /^https:\/\/([a-z0-9-]+\.)*klipy\.com\/[\w\-./%?=&]{1,500}$/i
const MEDIA_REF = /^media:[A-Za-z0-9_-]{16,40}$/

export type GifRef = { kind: 'url'; url: string } | { kind: 'media'; id: string }

export function gifMessage(ref: GifRef): string {
  return GIF_PREFIX + (ref.kind === 'url' ? ref.url : `media:${ref.id}`)
}

/** The GIF in a message, or null for normal text (or a GIF from somewhere Vanity doesn't show). */
export function gifOf(text: string): GifRef | null {
  if (!text.startsWith(GIF_PREFIX)) return null
  const ref = text.slice(GIF_PREFIX.length).trim()
  if (KLIPY_URL.test(ref)) return { kind: 'url', url: ref }
  if (MEDIA_REF.test(ref)) return { kind: 'media', id: ref.slice(6) }
  return null
}

/** How a message reads in a one-line preview (notifications, chat lists). */
export const previewOf = (text: string): string => (gifOf(text) ? 'GIF' : text)
