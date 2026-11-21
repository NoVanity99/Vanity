import { previewOf } from '@shared/groups'
import { useEffect, useState } from 'react'
import type { Friend, FriendsList } from '@shared/types'

/**
 * Your friends, kept fresh in the background while you're signed in: who is online, what they
 * are playing and whether a message is waiting. The sidebar reads it for its counts, and the
 * differences between one look and the next become notifications (a friend came online,
 * started a game, or wrote to you).
 */

const REFRESH_MS = 20_000

export interface FriendNote {
  id: number
  kind: 'online' | 'playing' | 'message' | 'voice' | 'request'
  friend: Friend
  /** What happened, after the friend's name: "is online", "started playing Hades", "sent you a message". */
  action: string
  /** The message text, for a message. */
  detail: string | null
  /** Where clicking it goes. */
  to: string
  /** A message in a group chat: which one (clicking opens it). */
  group?: { id: string; name: string }
}

let current: FriendsList | null = null
const listeners = new Set<(list: FriendsList | null) => void>()
const noteListeners = new Set<(note: FriendNote) => void>()
/** What each friend was doing the last time we looked. Null until the first look, which announces nothing. */
let before: Map<string, { state: Friend['status']['state']; game: string | null; lastMessage: number; voiceRoom?: string | null }> | null = null
/** Who had asked to be your friend the last time we looked (null until the first look). */
let requestsBefore: Set<string> | null = null
let noteId = 1
/** Friends whose chat is open on screen: their messages don't need announcing while you're looking at them. */
const watching = new Map<string, number>()

/** A chat on screen calls this; the returned function says it is gone again. */
export function watchChat(friendId: string): () => void {
  watching.set(friendId, (watching.get(friendId) ?? 0) + 1)
  return () => {
    const n = (watching.get(friendId) ?? 1) - 1
    if (n > 0) watching.set(friendId, n)
    else watching.delete(friendId)
  }
}

/** What changed between two looks at the friends list, as notifications. Exported for tests. */
export function notesFor(prev: NonNullable<typeof before>, list: FriendsList, watched: string | null | ReadonlySet<string>): Omit<FriendNote, 'id'>[] {
  const isWatched = (id: string): boolean => (typeof watched === 'string' ? watched === id : !!watched?.has(id))
  const notes: Omit<FriendNote, 'id'>[] = []
  for (const friend of list.friends) {
    const was = prev.get(friend.id)
    // Someone who just became your friend: nothing to compare with yet.
    if (!was) continue
    const { state, gameName } = friend.status
    if (state === 'playing' && gameName && (was.state !== 'playing' || was.game !== gameName)) {
      notes.push({ kind: 'playing', friend, action: `started playing ${gameName}`, detail: null, to: `/friends/${friend.id}` })
    } else if (was.state === 'offline' && state !== 'offline') {
      notes.push({ kind: 'online', friend, action: 'is online', detail: null, to: `/friends/${friend.id}` })
    }
    // Went into a voice room you can join.
    if (friend.voice?.canJoin && friend.voice.roomId !== was.voiceRoom) {
      notes.push({ kind: 'voice', friend, action: friend.voice.count > 1 ? `joined voice with ${friend.voice.names.filter((n) => n !== friend.username).slice(0, 2).join(', ')}` : 'started a voice room', detail: null, to: '/voice' })
    }
    const last = friend.lastMessage
    if (last && !last.mine && last.id > was.lastMessage && !isWatched(friend.id)) {
      notes.push({ kind: 'message', friend, action: 'sent you a message', detail: previewOf(last.text), to: `/friends/${friend.id}` })
    }
  }
  return notes
}

/** New friend requests since the last look, as notifications. Exported for tests. */
export function requestNotes(prev: ReadonlySet<string>, list: FriendsList): Omit<FriendNote, 'id'>[] {
  return list.incoming
    .filter((r) => !prev.has(r.id))
    .map((r) => ({
      kind: 'request' as const,
      // A request comes from someone who isn't a friend yet: only what is public about them is known.
      friend: { ...r, bio: '', unread: 0, lastMessage: null, status: { state: 'online' as const, gameName: null, since: null, lastSeen: null }, totalPlaytimeSeconds: 0, gamesPlayed: 0, topGame: null, level: 0, xp: 0, voice: null },
      action: 'sent you a friend request',
      detail: null,
      to: '/friends'
    }))
}

const snapshot = (list: FriendsList): NonNullable<typeof before> =>
  new Map(list.friends.map((f) => [f.id, { state: f.status.state, game: f.status.gameName, lastMessage: f.lastMessage?.id ?? 0, voiceRoom: f.voice?.roomId ?? null }]))

/** Takes a freshly fetched list (from the background refresh, or a page that just loaded one). */
export function publishFriends(list: FriendsList | null): void {
  if (list && before) {
    const looking = document.hasFocus() ? new Set(watching.keys()) : null
    for (const note of [...notesFor(before, list, looking), ...(requestsBefore ? requestNotes(requestsBefore, list) : [])]) {
      const full = { ...note, id: noteId++ }
      for (const l of noteListeners) l(full)
    }
  }
  before = list ? snapshot(list) : null
  requestsBefore = list ? new Set(list.incoming.map((r) => r.id)) : null
  current = list
  for (const l of listeners) l(list)
}

let refreshing: Promise<void> | null = null
export function refreshFriends(): Promise<void> {
  refreshing ??= window.vanity.friends
    .list()
    .then(
      (r) => {
        if (r.error === undefined) publishFriends(r.data)
      },
      () => {}
    )
    .finally(() => (refreshing = null))
  return refreshing
}

/** Mounted once, at the top of the app: keeps the list fresh while there is an account to ask for. */
export function useFriendsRefresh(username: string | null | undefined): void {
  useEffect(() => {
    if (!username) {
      publishFriends(null)
      return
    }
    void refreshFriends()
    const timer = setInterval(() => void refreshFriends(), REFRESH_MS)
    // Coming back to the window: catch up straight away.
    const onFocus = (): void => void refreshFriends()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [username])
}

/** The friends list right now (outside React). */
export const currentFriends = (): FriendsList | null => current

export function useFriends(): FriendsList | null {
  const [list, setList] = useState<FriendsList | null>(current)
  useEffect(() => {
    listeners.add(setList)
    setList(current)
    return () => {
      listeners.delete(setList)
    }
  }, [])
  return list
}

/** Shows a notification card from elsewhere (group chats). */
export function emitFriendNote(note: Omit<FriendNote, 'id'>): void {
  const full = { ...note, id: noteId++ }
  for (const l of noteListeners) l(full)
}

/** Whether a chat (a friend's id, or "group:<id>") is open on screen right now. */
export function isWatched(id: string): boolean {
  return document.hasFocus() && watching.has(id)
}

export function onFriendNote(listener: (note: FriendNote) => void): () => void {
  noteListeners.add(listener)
  return () => {
    noteListeners.delete(listener)
  }
}
