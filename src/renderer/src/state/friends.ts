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
  kind: 'online' | 'playing' | 'message'
  friend: Friend
  /** What happened, after the friend's name: "is online", "started playing Hades", "sent you a message". */
  action: string
  /** The message text, for a message. */
  detail: string | null
  /** Where clicking it goes. */
  to: string
}

let current: FriendsList | null = null
const listeners = new Set<(list: FriendsList | null) => void>()
const noteListeners = new Set<(note: FriendNote) => void>()
/** What each friend was doing the last time we looked. Null until the first look, which announces nothing. */
let before: Map<string, { state: Friend['status']['state']; game: string | null; lastMessage: number }> | null = null
let noteId = 1
/** The friend whose chat is open on screen: their messages don't need announcing while you're looking at them. */
let openChat: string | null = null

export function setOpenChat(friendId: string | null): void {
  openChat = friendId
}

/** What changed between two looks at the friends list, as notifications. Exported for tests. */
export function notesFor(prev: NonNullable<typeof before>, list: FriendsList, watching: string | null): Omit<FriendNote, 'id'>[] {
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
    const last = friend.lastMessage
    if (last && !last.mine && last.id > was.lastMessage && watching !== friend.id) {
      notes.push({ kind: 'message', friend, action: 'sent you a message', detail: last.text, to: `/friends/${friend.id}?chat=1` })
    }
  }
  return notes
}

const snapshot = (list: FriendsList): NonNullable<typeof before> =>
  new Map(list.friends.map((f) => [f.id, { state: f.status.state, game: f.status.gameName, lastMessage: f.lastMessage?.id ?? 0 }]))

/** Takes a freshly fetched list (from the background refresh, or a page that just loaded one). */
export function publishFriends(list: FriendsList | null): void {
  if (list && before) {
    const watching = openChat && document.hasFocus() ? openChat : null
    for (const note of notesFor(before, list, watching)) {
      const full = { ...note, id: noteId++ }
      for (const l of noteListeners) l(full)
    }
  }
  before = list ? snapshot(list) : null
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

export function onFriendNote(listener: (note: FriendNote) => void): () => void {
  noteListeners.add(listener)
  return () => {
    noteListeners.delete(listener)
  }
}
