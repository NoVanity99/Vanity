// "Channels": communities like a Discord server, with rooms inside them.
//
// NAMING. In the app a community is called a "Channel", and the rooms inside it are called
// "channels" (as Discord does). In code those two would be impossible to tell apart, so here a
// community is always a `Community` and a room inside it is always a `Channel`:
//
//   what the user sees      in code
//   ---------------------   -----------------
//   a Channel               Community
//   a channel (a room)      Channel
//   a category of channels  Category
//
// (Voice rooms, which already existed, are "rooms" in code. They are unrelated.)
//
// This file has no imports, so the app, the server and the tests all share it as-is.

/** Who may find and join a community. */
export type Visibility = 'open' | 'private' | 'hidden'
export const VISIBILITIES: { id: Visibility; label: string; hint: string }[] = [
  { id: 'open', label: 'Open', hint: 'Shows in Discover. Anyone can join straight away.' },
  { id: 'private', label: 'Private', hint: 'Shows in Discover with a lock. People ask to join and you approve them, or you invite them.' },
  { id: 'hidden', label: 'Hidden', hint: 'Never shown in Discover or search. The only way in is an invite.' }
]

/** Built-in roles, highest first. A role can only act on roles below it. */
export type Role = 'owner' | 'admin' | 'mod' | 'member'
export const ROLES: { id: Role; label: string; rank: number }[] = [
  { id: 'owner', label: 'Owner', rank: 3 },
  { id: 'admin', label: 'Admin', rank: 2 },
  { id: 'mod', label: 'Moderator', rank: 1 },
  { id: 'member', label: 'Member', rank: 0 }
]
export const rankOf = (role: Role | null | undefined): number => ROLES.find((r) => r.id === role)?.rank ?? -1

/** What a role may do. */
export type Permission = 'manageCommunity' | 'manageChannels' | 'manageRoles' | 'kick' | 'ban' | 'deleteMessages' | 'invite' | 'approveRequests'
const PERMISSIONS: Record<Role, Permission[]> = {
  owner: ['manageCommunity', 'manageChannels', 'manageRoles', 'kick', 'ban', 'deleteMessages', 'invite', 'approveRequests'],
  admin: ['manageCommunity', 'manageChannels', 'manageRoles', 'kick', 'ban', 'deleteMessages', 'invite', 'approveRequests'],
  mod: ['kick', 'deleteMessages', 'invite', 'approveRequests'],
  member: []
}
export const can = (role: Role | null | undefined, permission: Permission): boolean => !!role && PERMISSIONS[role].includes(permission)

export const LIMITS = {
  communityName: 50,
  description: 200,
  channelName: 50,
  categoryName: 40,
  message: 2000,
  /** Communities one account may be in. */
  joined: 100,
  channels: 200,
  categories: 50,
  members: 5000,
  invites: 50,
  /** Different emoji on one message. */
  reactions: 20,
  /** Custom roles in one community. */
  customRoles: 25,
  roleName: 30,
  /** Pictures and files on one message, and how big each may be. */
  attachments: 10,
  fileBytes: 25 * 1024 * 1024,
  fileName: 120
} as const

/** Who a channel is for. 'view': only chosen roles see it. 'post': everyone reads, only chosen roles write. */
export type Restriction = 'none' | 'view' | 'post'

/** A role an owner made up: a name and a colour, and a way into restricted channels. */
export interface CustomRole {
  id: string
  name: string
  /** A colour as #rrggbb. */
  color: string
  position: number
}
/** The colours offered for a custom role. */
export const ROLE_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#94a3b8'] as const

/** The names written after an @ in a message (letters, numbers and underscores, as usernames are). */
export function mentionedNames(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(/(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])/g)) found.add(m[2].toLowerCase())
  return [...found].slice(0, 20)
}

/** Types shown right in the chat. Everything else is a file to download. */
export const INLINE_IMAGE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export const INLINE_VIDEO = ['video/mp4', 'video/webm'] as const
export const INLINE_AUDIO = ['audio/mpeg', 'audio/ogg', 'audio/wav'] as const

/** A file size in words: "3.2 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * A name as typed, tidied: spaces at the ends removed and runs of spaces made one. Capitals,
 * spaces and emoji stay exactly as they are ("Late Night Gaming 🎮" is a fine channel name).
 * Returns '' for a name that is empty or only spaces, and cuts at `max` characters.
 */
export function tidyName(name: unknown, max: number): string {
  if (typeof name !== 'string') return ''
  const clean = name.replace(/[\u0000-\u001f\u007f​-‍﻿]+/g, ' ').replace(/\s+/g, ' ').trim()
  return [...clean].slice(0, max).join('').trim()
}

/** What a new community starts with. */
export interface Template {
  id: 'gaming' | 'friends' | 'community' | 'scratch'
  label: string
  hint: string
  emoji: string
  categories: { name: string; channels: string[] }[]
}
export const TEMPLATES: Template[] = [
  { id: 'gaming', label: 'Gaming Group', hint: 'For a clan, a guild or the people you play with.', emoji: '🎮', categories: [{ name: 'General', channels: ['General', 'Announcements 📣'] }, { name: 'Gaming', channels: ['Looking For Group', 'Clips & Highlights 🎬', 'Game Chat'] }, { name: 'Off Topic', channels: ['Off Topic', 'Memes 😂'] }] },
  { id: 'friends', label: 'Friends', hint: 'A place for you and your friends to hang out.', emoji: '🫶', categories: [{ name: 'Hangout', channels: ['General', 'Plans 📅', 'Memes 😂'] }] },
  { id: 'community', label: 'Community', hint: 'For a bigger group around a game or a topic.', emoji: '🌍', categories: [{ name: 'Info', channels: ['Welcome 👋', 'Rules', 'Announcements 📣'] }, { name: 'General', channels: ['General', 'Introductions'] }, { name: 'Off Topic', channels: ['Off Topic'] }] },
  { id: 'scratch', label: 'Start from Scratch', hint: 'One channel. Build the rest yourself.', emoji: '✨', categories: [{ name: 'General', channels: ['General'] }] }
]

/** Someone, as others see them (the same as everywhere else in Vanity). */
export interface CommunityUser {
  id: string
  username: string
  avatar: string | null
  style: unknown
  verified: boolean
  admin: boolean
}

/** A community as a card: what Discover and "My Channels" show. */
export interface CommunityCard {
  id: string
  name: string
  description: string
  /** A small square picture (a data: image), or null for initials. */
  icon: string | null
  /** A banner id from Vanity's banner list. */
  banner: string
  visibility: Visibility
  members: number
  online: number
  /** Your role, or null if you're not in it. */
  role: Role | null
  /** You've asked to join and are waiting. */
  requested: boolean
  /** Messages you haven't read, across its channels (0 when you're not in it). */
  unread: number
  /** How many of those mention you. */
  mentions: number
}

export interface Channel {
  id: string
  name: string
  categoryId: string | null
  position: number
  unread: number
  /** Unread messages that mention you. */
  mentions: number
  restricted: Restriction
  /** The custom roles a restricted channel is for (staff are always let in). */
  roleIds: string[]
  /** You may write here. */
  canPost: boolean
}
export interface Category {
  id: string
  name: string
  position: number
}

/** A community you're in, in full. */
export interface CommunityDetail extends CommunityCard {
  ownerId: string
  categories: Category[]
  channels: Channel[]
  /** People waiting to be let in (shown to those who may approve them). */
  pendingRequests: number
  createdAt: number | null
  roles: CustomRole[]
  /** The custom roles you hold. */
  myRoleIds: string[]
  /** Pictures and files can be sent (the server has somewhere to keep them). */
  filesEnabled: boolean
}

export interface CommunityMember {
  user: CommunityUser
  role: Role
  online: boolean
  joinedAt: number | null
  roleIds: string[]
}

/** A picture or file on a message. */
export interface Attachment {
  id: string
  name: string
  size: number
  type: string
  /** Where to get it, from the server's address onwards ("/files/…"). */
  path: string
}

export interface Reaction {
  emoji: string
  count: number
  /** You're one of them. */
  mine: boolean
}

export interface ChannelMessage {
  id: number
  channelId: string
  sender: CommunityUser | null
  /** '' when the message was deleted. */
  text: string
  at: number | null
  editedAt: number | null
  deleted: boolean
  /** The message this one answers (a short quote of it), if any. */
  replyTo: { id: number; sender: string; text: string } | null
  reactions: Reaction[]
  attachments: Attachment[]
  /** The colour of the sender's top custom role, if they have one. */
  color: string | null
  /** This message mentions you. */
  mentionsMe: boolean
  /** The people it mentions, as they're named now: [id, username]. */
  mentions: [string, string][]
  /** The sender's own tag for it, so a message sent twice (after a lost answer) is kept once. */
  nonce: string | null
}

export interface MessagePage {
  messages: ChannelMessage[]
  hasMore: boolean
  /** Pass back as `since` to get what changed after this (new, edited, deleted, reacted). */
  now: number
  /** People writing in this channel right now. */
  typing: string[]
}

/** Someone invited you to a community directly. */
export interface DirectInvite {
  community: CommunityCard
  by: string
  at: number | null
}

export interface Invite {
  code: string
  createdBy: string
  expiresAt: number | null
  maxUses: number | null
  uses: number
  createdAt: number | null
}

export interface JoinRequest {
  user: CommunityUser
  message: string
  at: number | null
}

export interface Ban {
  user: CommunityUser
  reason: string
  at: number | null
}

/** Where you last were, so Vanity reopens there on any PC. */
export interface LastPlace {
  communityId: string | null
  channelId: string | null
}
