import { useEffect, useState } from 'react'
import type { Friend } from '@shared/types'
import { loadPref, savePref } from '@/lib/storage'

/**
 * The chat pop-ups along the bottom of the window. A chat opened from anywhere stays open as you
 * move between pages, and comes back after Vanity restarts. Minimizing folds it into a small bar;
 * closing only removes the pop-up: the conversation itself is kept on the server for good.
 */

/** What a pop-up needs to draw its header before the friends list has loaded. */
export type ChatFriend = Pick<Friend, 'id' | 'username' | 'avatar' | 'style' | 'verified' | 'admin'>

export interface OpenChat {
  friend: ChatFriend
  minimized: boolean
}

/** At most this many pop-ups at once; opening another closes the oldest. */
export const MAX_OPEN_CHATS = 3

const KEY = 'chat-popups'
interface Saved {
  /** The account these pop-ups belong to: another account starts with none. */
  owner: string | null
  chats: OpenChat[]
}

let state: Saved = loadPref<Saved>(KEY, { owner: null, chats: [] })
if (!Array.isArray(state.chats)) state = { owner: null, chats: [] }
const listeners = new Set<(chats: OpenChat[]) => void>()

function set(chats: OpenChat[]): void {
  state = { ...state, chats }
  savePref(KEY, state)
  for (const l of listeners) l(chats)
}

/**
 * The pop-ups belong to one account: signing in as someone else closes them. Signed out they
 * are only hidden (the app can say "signed out" for a moment while it starts), so they come
 * back when the same account signs in again.
 */
export function setChatOwner(username: string | null): void {
  if (!username || state.owner === username) return
  const keep = state.owner === null
  state = { owner: username, chats: keep ? state.chats : [] }
  set(state.chats)
}

const slim = (f: ChatFriend): ChatFriend => ({ id: f.id, username: f.username, avatar: f.avatar ?? null, style: f.style, verified: f.verified === true, admin: f.admin === true })

/** Group chats share the pop-ups: their id there is "group:<id>". */
export const groupChatId = (groupId: string): string => `group:${groupId}`
export const isGroupChat = (id: string): boolean => id.startsWith('group:')

/** Opens (or brings back up) a group chat's pop-up. */
export function openGroupChat(group: { id: string; name: string }): void {
  openChat({ id: groupChatId(group.id), username: group.name, avatar: null, style: undefined as never, verified: false, admin: false })
}

/** Opens (or brings back up) the chat with a friend. */
export function openChat(friend: ChatFriend): void {
  const rest = state.chats.filter((c) => c.friend.id !== friend.id)
  const next = [...rest, { friend: slim(friend), minimized: false }]
  // Too many: the oldest goes (its chat is still saved, of course).
  set(next.slice(-MAX_OPEN_CHATS))
}

export function minimizeChat(id: string, minimized = true): void {
  set(state.chats.map((c) => (c.friend.id === id ? { ...c, minimized } : c)))
}

export function closeChat(id: string): void {
  set(state.chats.filter((c) => c.friend.id !== id))
}

/** Keeps the saved picture, name and look up to date as the friends list refreshes. */
export function refreshChatFriends(friends: ChatFriend[]): void {
  const byId = new Map(friends.map((f) => [f.id, f]))
  let changed = false
  const next = state.chats.map((c) => {
    const f = byId.get(c.friend.id)
    if (!f) return c
    const fresh = slim(f)
    if (JSON.stringify(fresh) === JSON.stringify(c.friend)) return c
    changed = true
    return { ...c, friend: fresh }
  })
  if (changed) set(next)
}

export function useOpenChats(): OpenChat[] {
  const [chats, setChats] = useState<OpenChat[]>(state.chats)
  useEffect(() => {
    listeners.add(setChats)
    setChats(state.chats)
    return () => {
      listeners.delete(setChats)
    }
  }, [])
  return chats
}
