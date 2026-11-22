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
  reactions: 20
} as const

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
}

export interface Channel {
  id: string
  name: string
  categoryId: string | null
  position: number
  unread: number
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
}

export interface CommunityMember {
  user: CommunityUser
  role: Role
  online: boolean
  joinedAt: number | null
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
}

export interface MessagePage {
  messages: ChannelMessage[]
  hasMore: boolean
  /** Pass back as `since` to get what changed after this (new, edited, deleted, reacted). */
  now: number
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
