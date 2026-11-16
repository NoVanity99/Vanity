import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2, Users } from 'lucide-react'
import { gifOf, type GroupChat as Group, type GroupMessage } from '@shared/groups'
import { Avatar } from '@/components/Avatar'
import { UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { bigEmoji } from '@/lib/emoji'
import { useAccount } from '@/state/account'
import { groupChatId } from '@/state/chats'
import { watchChat } from '@/state/friends'
import { refreshGroups } from '@/state/groups'
import { ChatComposer } from './ChatComposer'
import { ChatGif } from './ChatGif'

const POLL_MS = 3000

const dayOf = (at: number | null): string => (at ? new Date(at).toDateString() : '')
function dayLabel(at: number | null): string {
  if (!at) return ''
  const d = new Date(at)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === new Date(today.getTime() - 86_400_000).toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
const timeOf = (at: number | null): string => (at ? new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '')

/**
 * A group chat: everyone's messages with their picture and name, GIFs, emoji. Kept on Vanity's
 * server for good; new messages arrive every few seconds while it's open.
 */
export function GroupChat({ group, header, className }: { group: Group; header?: React.ReactNode; className?: string }): React.JSX.Element {
  const account = useAccount()
  const me = group.members.find((m) => m.username === account?.username)?.id ?? ''
  const [messages, setMessages] = useState<GroupMessage[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const lastId = useRef(0)

  const merge = useCallback((incoming: GroupMessage[], where: 'end' | 'start') => {
    setMessages((prev) => {
      const have = new Set((prev ?? []).map((m) => m.id))
      const fresh = incoming.filter((m) => !have.has(m.id))
      const next = where === 'end' ? [...(prev ?? []), ...fresh] : [...fresh, ...(prev ?? [])]
      lastId.current = next.length ? next[next.length - 1].id : 0
      return next
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    setMessages(null)
    setError(null)
    lastId.current = 0
    atBottom.current = true
    const first = async (): Promise<void> => {
      const r = await window.vanity.groups.messages(group.id).catch(() => null)
      if (cancelled) return
      if (!r) return setError("Couldn't load the chat. Check your connection.")
      if (r.error !== undefined) return setError(r.error)
      setMore(r.data.hasMore)
      setMessages([])
      merge(r.data.messages, 'end')
      void refreshGroups()
    }
    const poll = async (): Promise<void> => {
      if (document.hidden || !lastId.current) return
      const r = await window.vanity.groups.messages(group.id, { after: lastId.current }).catch(() => null)
      if (cancelled || !r || r.error !== undefined || !r.data.messages.length) return
      merge(r.data.messages, 'end')
      void refreshGroups()
    }
    void first()
    const timer = setInterval(() => void poll(), POLL_MS)
    const unwatch = watchChat(groupChatId(group.id))
    return () => {
      cancelled = true
      clearInterval(timer)
      unwatch()
    }
  }, [group.id, merge])

  useLayoutEffect(() => {
    const el = box.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const older = async (): Promise<void> => {
    const el = box.current
    if (!messages?.length || loadingOlder) return
    setLoadingOlder(true)
    const heightBefore = el?.scrollHeight ?? 0
    const r = await window.vanity.groups.messages(group.id, { before: messages[0].id }).catch(() => null)
    setLoadingOlder(false)
    if (!r || r.error !== undefined) return
    atBottom.current = false
    setMore(r.data.hasMore)
    merge(r.data.messages, 'start')
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - heightBefore
    })
  }

  const send = async (text: string): Promise<boolean> => {
    setError(null)
    const r = await window.vanity.groups.send(group.id, text).catch(() => null)
    if (!r || r.error !== undefined) {
      setError(r?.error ?? "Couldn't send that. Check your connection and try again.")
      return false
    }
    atBottom.current = true
    merge([r.data], 'end')
    return true
  }

  const byId = new Map(group.members.map((m) => [m.id, m]))

  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden bg-surface', className)} data-group-chat={group.name}>
      {header}
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-4 [scrollbar-width:thin]"
        data-chat-messages
      >
        {messages === null && !error ? (
          <div className="flex h-full items-center justify-center text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : messages && messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted">
            <Users className="size-8 opacity-40" />
            <p>No messages yet. Say hi to the group!</p>
            <p className="max-w-xs text-xs">{group.members.map((m) => m.username).join(', ')}</p>
          </div>
        ) : (
          <>
            {more && (
              <div className="pb-2 text-center">
                <button onClick={() => void older()} disabled={loadingOlder} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted transition hover:border-white/25 hover:text-text disabled:opacity-60">
                  {loadingOlder ? <Loader2 className="size-3 animate-spin" /> : <ArrowUp className="size-3" />} Earlier messages
                </button>
              </div>
            )}
            {messages?.map((m, i) => {
              const mine = m.senderId === me
              const prev = messages[i - 1]
              const newDay = i === 0 || dayOf(prev.at) !== dayOf(m.at)
              const joined = !newDay && i > 0 && prev.senderId === m.senderId && (m.at ?? 0) - (prev.at ?? 0) < 5 * 60_000
              const who = byId.get(m.senderId)
              const name = who?.username ?? 'Someone who left'
              const gif = gifOf(m.text)
              return (
                <div key={m.id}>
                  {newDay && (
                    <p className="my-3 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-widest text-muted/80">
                      <span className="h-px flex-1 bg-border" />
                      {dayLabel(m.at)}
                      <span className="h-px flex-1 bg-border" />
                    </p>
                  )}
                  <div className={cn('flex items-end gap-2', mine ? 'justify-end' : 'justify-start', joined ? 'mt-0.5' : 'mt-2.5')} data-message={mine ? 'mine' : 'theirs'}>
                    {!mine && <span className="w-7 shrink-0">{!joined && <Avatar name={name} src={who?.avatar ?? null} size="sm" />}</span>}
                    <div className={cn('flex min-w-0 max-w-[78%] flex-col', mine ? 'items-end' : 'items-start')}>
                      {!mine && !joined && (
                        <span className="mb-0.5 px-1 text-[11px] font-semibold">
                          <UserName name={name} style={who?.style as never} verified={who?.verified} admin={who?.admin} />
                        </span>
                      )}
                      {gif ? (
                        <span title={m.at ? new Date(m.at).toLocaleString() : undefined} className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}>
                          <ChatGif gif={gif} />
                          <span className="pb-1 text-[10px] tabular-nums text-muted">{timeOf(m.at)}</span>
                        </span>
                      ) : bigEmoji(m.text) ? (
                        <span title={m.at ? new Date(m.at).toLocaleString() : undefined} className="text-4xl leading-tight">
                          {m.text.trim()}
                        </span>
                      ) : (
                        <div title={m.at ? new Date(m.at).toLocaleString() : undefined} className={cn('whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed', mine ? 'rounded-br-md bg-accent text-white' : 'rounded-bl-md bg-surface-2 text-text')}>
                          {m.text}
                          <span className={cn('ml-2 inline-block translate-y-0.5 text-[10px] tabular-nums', mine ? 'text-white/70' : 'text-muted')}>{timeOf(m.at)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="shrink-0 border-t border-accent/30 bg-accent/10 px-4 py-2 text-xs text-accent">
          {error}
        </p>
      )}
      <ChatComposer placeholder={`Message ${group.name}`} onSend={send} autoFocus focusKey={group.id} />
    </section>
  )
}
