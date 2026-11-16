import { useEffect, useState } from 'react'
import { previewOf, type GroupChat } from '@shared/groups'
import type { Friend } from '@shared/types'
import { emitFriendNote, isWatched } from './friends'
import { groupChatId } from './chats'

/**
 * Your group chats, kept fresh in the background (like the friends list): unread counts for the
 * sidebar and the Friends page, and a notification when someone writes in one.
 */

const REFRESH_MS = 15_000

let current: GroupChat[] | null = null
/** The newest message id in each group last time: null until the first look, which announces nothing. */
let seen: Map<string, number> | null = null
let myName: string | null = null
const listeners = new Set<(g: GroupChat[] | null) => void>()

function publish(list: GroupChat[] | null): void {
  if (list && seen) {
    for (const g of list) {
      const last = g.lastMessage
      const before = seen.get(g.id) ?? 0
      if (!last || last.id <= before || last.senderName === myName || isWatched(groupChatId(g.id))) continue
      const sender = g.members.find((m) => m.id === last.senderId)
      if (!sender) continue
      const asFriend: Friend = {
        ...sender,
        style: sender.style as Friend['style'],
        bio: '',
        unread: 0,
        lastMessage: null,
        status: { state: 'offline', gameName: null, since: null, lastSeen: null },
        totalPlaytimeSeconds: 0,
        gamesPlayed: 0,
        topGame: null,
        level: 1,
        xp: 0,
        voice: null
      }
      emitFriendNote({ kind: 'message', friend: asFriend, action: `wrote in ${g.name}`, detail: previewOf(last.text), to: '/friends', group: { id: g.id, name: g.name } })
    }
  }
  seen = list ? new Map(list.map((g) => [g.id, g.lastMessage?.id ?? 0])) : null
  current = list
  for (const l of listeners) l(list)
}

let refreshing: Promise<void> | null = null
export function refreshGroups(): Promise<void> {
  refreshing ??= window.vanity.groups
    .list()
    .then(
      (r) => {
        if (r.error === undefined) publish(r.data)
      },
      () => {}
    )
    .finally(() => (refreshing = null))
  return refreshing
}

/** Mounted once at the top of the app. */
export function useGroupsRefresh(username: string | null | undefined): void {
  useEffect(() => {
    myName = username ?? null
    if (!username) {
      publish(null)
      return
    }
    void refreshGroups()
    const timer = setInterval(() => void refreshGroups(), REFRESH_MS)
    const onFocus = (): void => void refreshGroups()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [username])
}

/** Your group chats right now (outside React). */
export const currentGroups = (): GroupChat[] | null => current

export function useGroups(): GroupChat[] | null {
  const [list, setList] = useState<GroupChat[] | null>(current)
  useEffect(() => {
    listeners.add(setList)
    setList(current)
    return () => {
      listeners.delete(setList)
    }
  }, [])
  return list
}
