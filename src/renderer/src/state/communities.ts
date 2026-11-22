import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChannelMessage, CommunityCard, CommunityDetail, CommunityMember, LastPlace, MessagePage } from '@shared/communities'

// The app's side of "Channels" (see src/shared/communities.ts for the naming: a community is
// what people see as a Channel; a channel here is one of its rooms).
//
// Nothing is kept only on this device: everything comes from the Vanity server and is asked for
// again every few seconds while it is on screen, which is how changes other people make show up.

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
/** One request to the server. Throws with a message that can be shown. */
export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const r = await window.vanity.account.request<T>(method, `/communities${path}`, body).catch(() => null)
  if (!r) throw new Error("Couldn't reach Vanity. Check your connection.")
  if (r.error !== undefined) throw new Error(r.error)
  return r.data
}

// ---- the communities you're in (for the sidebar badge, the icon strip and "My Channels") ----

let mine: CommunityCard[] | null = null
let last: LastPlace = { communityId: null, channelId: null }
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())
let loading: Promise<void> | null = null
let placeKnown = false

export function refreshCommunities(): Promise<void> {
  loading ??= api<{ communities: CommunityCard[]; last: LastPlace }>('GET', '')
    .then(
      (r) => {
        mine = r.communities
        // Where you were comes from the server once; after that this device is the one saying.
        if (!placeKnown) last = r.last
        placeKnown = true
        emit()
      },
      () => {}
    )
    .finally(() => (loading = null))
  return loading
}
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
/** The communities you're in (null until first loaded, or when signed out). */
export const useMyCommunities = (): CommunityCard[] | null => useSyncExternalStore(subscribe, () => mine)
/** Where you last were (from the server, so it is the same on every PC). */
export const lastPlace = (): LastPlace => last

/** Mounted once: keeps the list fresh while signed in. */
export function useCommunitiesRefresh(username: string | null | undefined): void {
  useEffect(() => {
    if (!username) {
      mine = null
      placeKnown = false
      last = { communityId: null, channelId: null }
      emit()
      return
    }
    void refreshCommunities()
    const timer = setInterval(() => void refreshCommunities(), 12_000)
    const onFocus = (): void => void refreshCommunities()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [username])
}

/** Remembers the place you're looking at, on the server (a moment after you settle there). */
let placeTimer: ReturnType<typeof setTimeout> | null = null
export function rememberPlace(communityId: string | null, channelId: string | null): void {
  if (last.communityId === communityId && last.channelId === channelId) return
  const place = (last = { communityId, channelId })
  if (placeTimer) clearTimeout(placeTimer)
  placeTimer = setTimeout(() => void api('PUT', '/last-place', place).catch(() => {}), 800)
}

// ---- one community, kept current while it is open ----

const DETAIL_MS = 4000
export interface OpenCommunity {
  community: CommunityDetail | null
  /** Why it can't be shown (left, kicked, deleted, offline…). */
  error: string | null
  refresh(): Promise<void>
  /** Shows a change at once, ahead of the server's answer. */
  patch(change: (c: CommunityDetail) => CommunityDetail): void
}
export function useCommunity(id: string | null): OpenCommunity {
  const [community, setCommunity] = useState<CommunityDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef(id)
  current.current = id
  const refresh = useCallback(async (): Promise<void> => {
    if (!id) return
    try {
      const r = await api<{ community: CommunityDetail; member: boolean }>('GET', `/${id}`)
      if (current.current !== id) return
      if (!r.member) {
        setCommunity(null)
        setError("You're not in this Channel any more.")
        void refreshCommunities()
      } else {
        setCommunity(r.community)
        setError(null)
      }
    } catch (e) {
      if (current.current !== id) return
      const message = e instanceof Error ? e.message : 'That did not work.'
      // Offline: keep showing what we have. Gone: say so.
      if (/doesn't exist|can't see/i.test(message)) {
        setCommunity(null)
        setError(message)
        void refreshCommunities()
      } else setError((prev) => (community ? prev : message))
    }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setCommunity(null)
    setError(null)
    if (!id) return
    void refresh()
    const timer = setInterval(() => !document.hidden && void refresh(), DETAIL_MS)
    return () => clearInterval(timer)
  }, [id, refresh])
  return { community, error, refresh, patch: (change) => setCommunity((c) => (c ? change(c) : c)) }
}

/** The people in a community (asked for again now and then while the list is showing). */
export function useMembers(id: string | null, on: boolean): { members: CommunityMember[] | null; refresh(): void } {
  const [members, setMembers] = useState<CommunityMember[] | null>(null)
  const load = useCallback(() => {
    if (!id) return
    void api<{ members: CommunityMember[] }>('GET', `/${id}/members`).then((r) => setMembers(r.members), () => {})
  }, [id])
  useEffect(() => {
    setMembers(null)
    if (!id || !on) return
    load()
    const timer = setInterval(() => !document.hidden && load(), 15_000)
    return () => clearInterval(timer)
  }, [id, on, load])
  return { members, refresh: load }
}

// ---- the messages of one channel (room) ----

const MESSAGES_MS = 2000
export interface OpenChannel {
  messages: ChannelMessage[] | null
  hasMore: boolean
  error: string | null
  loadingOlder: boolean
  older(): Promise<void>
  /** Puts a message in (sent, edited, reacted to) at once. */
  put(message: ChannelMessage): void
}
export function useChannelMessages(channelId: string | null): OpenChannel {
  const [messages, setMessages] = useState<ChannelMessage[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const since = useRef(0)
  const current = useRef(channelId)
  current.current = channelId

  /** New and changed messages go in by id: a change replaces what was there. */
  const merge = useCallback((incoming: ChannelMessage[], where: 'end' | 'start' = 'end') => {
    if (!incoming.length) return
    setMessages((prev) => {
      const byId = new Map((prev ?? []).map((m) => [m.id, m]))
      for (const m of incoming) byId.set(m.id, m)
      const all = [...byId.values()].sort((a, b) => a.id - b.id)
      return where === 'start' || all.length !== (prev?.length ?? 0) || incoming.some((m) => JSON.stringify(m) !== JSON.stringify(prev?.find((p) => p.id === m.id))) ? all : prev
    })
  }, [])

  useEffect(() => {
    setMessages(null)
    setHasMore(false)
    setError(null)
    since.current = 0
    if (!channelId) return
    let cancelled = false
    const first = async (): Promise<void> => {
      try {
        const r = await api<MessagePage>('GET', `/channels/${channelId}/messages`)
        if (cancelled) return
        since.current = r.now
        setHasMore(r.hasMore)
        setMessages(r.messages)
        void refreshCommunities()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load the messages.")
      }
    }
    const poll = async (): Promise<void> => {
      if (document.hidden || !since.current) return
      try {
        const r = await api<MessagePage>('GET', `/channels/${channelId}/messages?since=${since.current}`)
        if (cancelled) return
        since.current = r.now
        setError(null)
        merge(r.messages)
      } catch {
        // A missed look is made up for by the next one (it asks from the same point).
      }
    }
    void first()
    const timer = setInterval(() => void poll(), MESSAGES_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [channelId, merge])

  const older = async (): Promise<void> => {
    if (!channelId || !messages?.length || loadingOlder) return
    setLoadingOlder(true)
    try {
      const r = await api<MessagePage>('GET', `/channels/${channelId}/messages?before=${messages[0].id}`)
      if (current.current !== channelId) return
      setHasMore(r.hasMore)
      merge(r.messages, 'start')
    } catch {
      // Stays as it is; the button is still there.
    } finally {
      setLoadingOlder(false)
    }
  }
  return { messages, hasMore, error, loadingOlder, older, put: (m) => merge([m]) }
}
