import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { LIMITS, type Attachment, type ChannelMessage, type CommunityCard, type CommunityDetail, type CommunityMember, type DirectInvite, type LastPlace, type MessagePage } from '@shared/communities'

// The app's side of "Channels" (see src/shared/communities.ts for the naming: a community is
// what people see as a Channel; a channel here is one of its rooms).
//
// Nothing is kept only on this device: everything comes from the Vanity server and is asked for
// again every few seconds while it is on screen, which is how changes other people make show up.

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
/** One request to the server. Throws with a message that can be shown. */
export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const r = await window.vanity.account.request<T>(method, `/communities${path}`, body).catch(() => null)
  if (!r) throw new Offline()
  if (r.error !== undefined) throw /^You're offline|^Couldn't reach|server is having trouble/i.test(r.error) ? new Offline(r.error) : new Error(r.error)
  return r.data
}
/** The server couldn't be reached (as opposed to: it answered "no"). Worth trying again. */
export class Offline extends Error {
  constructor(message = "Couldn't reach Vanity. Check your connection.") {
    super(message)
  }
}

// ---- the communities you're in (for the sidebar badge, the icon strip and "My Channels") ----

let mine: CommunityCard[] | null = null
let invitations: DirectInvite[] = []
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
    .then(() => api<{ invites: DirectInvite[] }>('GET', '/direct-invites'))
    .then(
      (r) => {
        if (JSON.stringify(r.invites) === JSON.stringify(invitations)) return
        invitations = r.invites
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
/** Communities someone has invited you into and you haven't answered. */
export const useInvitations = (): DirectInvite[] => useSyncExternalStore(subscribe, () => invitations)
/** Where you last were (from the server, so it is the same on every PC). */
export const lastPlace = (): LastPlace => last

/** Mounted once: keeps the list fresh while signed in. */
export function useCommunitiesRefresh(username: string | null | undefined): void {
  useEffect(() => {
    if (!username) {
      mine = null
      invitations = []
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
  /** People writing here right now. */
  typing: string[]
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
  const [typing, setTyping] = useState<string[]>([])
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
    setTyping([])
    since.current = 0
    if (!channelId) return
    let cancelled = false
    // Messages of yours that were waiting to be sent land here when they get through.
    const off = onDelivered(channelId, (m) => merge([m]))
    const sameNames = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])
    const first = async (): Promise<void> => {
      try {
        const r = await api<MessagePage>('GET', `/channels/${channelId}/messages`)
        if (cancelled) return
        since.current = r.now
        setHasMore(r.hasMore)
        setMessages(r.messages)
        setTyping(r.typing ?? [])
        void refreshCommunities()
        void flushOutbox()
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
        setTyping((prev) => (sameNames(prev, r.typing ?? []) ? prev : (r.typing ?? [])))
        void flushOutbox()
      } catch {
        // A missed look is made up for by the next one (it asks from the same point).
      }
    }
    void first()
    const timer = setInterval(() => void poll(), MESSAGES_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
      off()
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
  return { messages, hasMore, error, typing, loadingOlder, older, put: (m) => merge([m]) }
}

// ---- messages waiting to be sent ----
// A message you send goes into this list first and is shown at once as "Sending…". It leaves
// the list when the server has it. With no connection it waits here (and through a restart)
// and goes out when the connection is back. Each one carries its own tag, which the server
// uses to keep it once even if it had to be sent twice.

export interface Pending {
  nonce: string
  channelId: string
  text: string
  replyTo: { id: number; sender: string; text: string } | null
  attachments: Attachment[]
  at: number
  /** Set when the server said no (as opposed to: couldn't be reached). */
  failed: string | null
}
const OUTBOX_KEY = 'vanity.channels.outbox'
let outbox: Pending[] = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as Pending[]
    return Array.isArray(saved) ? saved.filter((p) => p && typeof p.nonce === 'string' && typeof p.channelId === 'string').slice(0, 200) : []
  } catch {
    return []
  }
})()
const outboxListeners = new Set<() => void>()
const saveOutbox = (next: Pending[]): void => {
  outbox = next
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(next))
  } catch {
    // Kept for this run only.
  }
  outboxListeners.forEach((l) => l())
}
const delivered = new Map<string, Set<(m: ChannelMessage) => void>>()
function onDelivered(channelId: string, fn: (m: ChannelMessage) => void): () => void {
  const set = delivered.get(channelId) ?? new Set()
  delivered.set(channelId, set)
  set.add(fn)
  return () => set.delete(fn)
}
let flushing = false
let retry: ReturnType<typeof setTimeout> | null = null
/** Sends what is waiting, oldest first. One that can't get through stops the rest of its channel (to keep the order). */
export async function flushOutbox(): Promise<void> {
  if (flushing) return
  flushing = true
  let offline = false
  try {
    const blocked = new Set<string>()
    for (const p of [...outbox]) {
      if (p.failed || blocked.has(p.channelId) || !outbox.includes(p)) continue
      try {
        const r = await api<{ message: ChannelMessage }>('POST', `/channels/${p.channelId}/messages`, { text: p.text, replyTo: p.replyTo?.id ?? null, attachments: p.attachments.map((a) => a.id), nonce: p.nonce })
        saveOutbox(outbox.filter((x) => x.nonce !== p.nonce))
        delivered.get(p.channelId)?.forEach((fn) => fn(r.message))
      } catch (e) {
        if (e instanceof Offline) {
          offline = true
          blocked.add(p.channelId)
        } else saveOutbox(outbox.map((x) => (x.nonce === p.nonce ? { ...x, failed: e instanceof Error ? e.message : 'That did not send.' } : x)))
      }
    }
  } finally {
    flushing = false
  }
  if (retry) clearTimeout(retry)
  if (offline) retry = setTimeout(() => void flushOutbox(), 4000)
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flushOutbox())
  if (outbox.some((p) => !p.failed)) setTimeout(() => void flushOutbox(), 3000)
}
/** Queues a message and starts sending it. */
export function sendLater(p: Omit<Pending, 'nonce' | 'at' | 'failed'>): void {
  const nonce = `${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, '0')).join('')}`
  saveOutbox([...outbox, { ...p, nonce, at: Date.now(), failed: null }])
  void flushOutbox()
}
export const retryPending = (nonce: string): void => {
  saveOutbox(outbox.map((x) => (x.nonce === nonce ? { ...x, failed: null } : x)))
  void flushOutbox()
}
export const dropPending = (nonce: string): void => saveOutbox(outbox.filter((x) => x.nonce !== nonce))
const subscribeOutbox = (l: () => void): (() => void) => {
  outboxListeners.add(l)
  return () => outboxListeners.delete(l)
}
const EMPTY: Pending[] = []
/** What is waiting to be sent in one channel. */
export function usePending(channelId: string): Pending[] {
  const all = useSyncExternalStore(subscribeOutbox, () => outbox)
  const mine = all.filter((p) => p.channelId === channelId)
  return mine.length ? mine : EMPTY
}

// ---- pictures and files ----

/** Sends a file to the server a part at a time, saying how far along it is (0 to 1). */
export async function uploadFile(channelId: string, file: File, onProgress: (done: number) => void, cancelled: () => boolean): Promise<Attachment> {
  if (file.size > LIMITS.fileBytes) throw new Error(`"${file.name}" is too big. Files can be up to ${LIMITS.fileBytes / 1024 / 1024} MB.`)
  if (!file.size) throw new Error(`"${file.name}" is empty.`)
  const start = await api<{ id: string; partSize: number; parts: number }>('POST', `/channels/${channelId}/uploads`, { name: file.name, size: file.size, type: file.type })
  let done: Attachment | null = null
  for (let n = 0; n < start.parts; n++) {
    if (cancelled()) {
      void api('DELETE', `/uploads/${start.id}`).catch(() => {})
      throw new Error('cancelled')
    }
    const bytes = new Uint8Array(await file.slice(n * start.partSize, (n + 1) * start.partSize).arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const data = btoa(binary)
    // A part that didn't get through is tried again a few times before giving up.
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await api<{ ready: boolean; attachment: Attachment | null }>('PUT', `/uploads/${start.id}/parts/${n}`, { data })
        if (r.attachment) done = r.attachment
        break
      } catch (e) {
        if (!(e instanceof Offline) || attempt >= 3) throw e
        await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)))
      }
    }
    onProgress((n + 1) / start.parts)
  }
  if (!done) throw new Error(`"${file.name}" didn't finish uploading. Try again.`)
  return done
}

let bases: { show: string; open: string } | null = null
let basesAsked: Promise<void> | null = null
const basesListeners = new Set<() => void>()
/** Where a file's path is added to, to show it inside Vanity or open it in the browser. */
export function useFileBases(): { show: string; open: string } | null {
  useEffect(() => {
    basesAsked ??= window.vanity.account.fileBases().then(
      (b) => {
        bases = b
        basesListeners.forEach((l) => l())
      },
      () => void (basesAsked = null)
    )
  }, [])
  return useSyncExternalStore(
    (l) => (basesListeners.add(l), () => basesListeners.delete(l)),
    () => bases
  )
}
