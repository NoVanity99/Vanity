import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, CornerUpLeft, Hash, Loader2, Pencil, SmilePlus, Trash2, X } from 'lucide-react'
import { can, type Channel, type ChannelMessage, type Role } from '@shared/communities'
import { gifOf } from '@shared/groups'
import type { ProfileStyle } from '@shared/profileStyle'
import { Avatar } from '@/components/Avatar'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatGif } from '@/components/chat/ChatGif'
import { LinkText } from '@/components/chat/LinkText'
import { EmojiPicker } from '@/components/EmojiPicker'
import { UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { bigEmoji } from '@/lib/emoji'
import { api, refreshCommunities, useChannelMessages } from '@/state/communities'
import { useToast } from '@/state/toasts'

const QUICK = ['👍', '❤️', '😂', '🔥', '🎮']
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
const styleOf = (s: unknown): Partial<ProfileStyle> | undefined => (s && typeof s === 'object' ? (s as Partial<ProfileStyle>) : undefined)

/** Lines of grey where messages will be. */
function MessagesSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-5 px-6 py-6" aria-hidden data-messages-skeleton>
      {[70, 45, 85, 55, 65, 40].map((w, i) => (
        <div key={i} className="flex gap-3">
          <div className="skeleton size-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="skeleton h-3 w-28 rounded" />
            <div className="skeleton h-3 rounded" style={{ width: `${w}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * One channel's (room's) chat: everyone's messages with their picture and current name, replies,
 * reactions, edits and deletions. New things from other people arrive within a couple of seconds.
 */
export function ChannelChat({ channel, role, myId, headerStart, headerEnd }: { channel: Channel; role: Role; myId: string | undefined; headerStart?: React.ReactNode; headerEnd?: React.ReactNode }): React.JSX.Element {
  const toast = useToast()
  const { messages, hasMore, error, loadingOlder, older, put } = useChannelMessages(channel.id)
  const [replyTo, setReplyTo] = useState<ChannelMessage | null>(null)
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null)
  const [picker, setPicker] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const seen = useRef(new Set<number>())
  const firstPaint = useRef(true)

  useEffect(() => {
    setReplyTo(null)
    setEditing(null)
    setPicker(null)
    atBottom.current = true
    seen.current = new Set()
    firstPaint.current = true
  }, [channel.id])

  useLayoutEffect(() => {
    const el = box.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
    // After the first paint, messages that weren't there before get a little entrance.
    if (messages) {
      for (const m of messages) seen.current.add(m.id)
      firstPaint.current = false
    }
  }, [messages])

  const fail = (e: unknown): void => toast(e instanceof Error ? e.message : 'That did not work.', 'error')
  const send = async (text: string): Promise<boolean> => {
    try {
      const r = await api<{ message: ChannelMessage }>('POST', `/channels/${channel.id}/messages`, { text, replyTo: replyTo?.id ?? null })
      atBottom.current = true
      put(r.message)
      setReplyTo(null)
      return true
    } catch (e) {
      fail(e)
      return false
    }
  }
  const react = async (m: ChannelMessage, emoji: string): Promise<void> => {
    const mine = m.reactions.find((r) => r.emoji === emoji)?.mine
    try {
      put((await api<{ message: ChannelMessage }>(mine ? 'DELETE' : 'PUT', `/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`)).message)
    } catch (e) {
      fail(e)
    }
  }
  const saveEdit = async (): Promise<void> => {
    if (!editing) return
    try {
      put((await api<{ message: ChannelMessage }>('PATCH', `/messages/${editing.id}`, { text: editing.text })).message)
      setEditing(null)
    } catch (e) {
      fail(e)
    }
  }
  const remove = async (m: ChannelMessage): Promise<void> => {
    try {
      await api('DELETE', `/messages/${m.id}`)
      put({ ...m, deleted: true, text: '', reactions: [], editedAt: null })
    } catch (e) {
      fail(e)
    }
  }
  const older_ = async (): Promise<void> => {
    const el = box.current
    const before = el?.scrollHeight ?? 0
    atBottom.current = false
    await older()
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - before
    })
  }
  const tool = 'rounded-md p-1.5 text-muted transition hover:bg-white/10 hover:text-text'

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-channel-chat={channel.name}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface/60 px-5 backdrop-blur max-md:px-2">
        {headerStart}
        <Hash className="size-4 shrink-0 text-muted" />
        <h2 className="min-w-0 flex-1 truncate font-display font-bold" data-channel-title>{channel.name}</h2>
        {headerEnd}
      </header>

      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
        className="thin-scroll min-h-0 flex-1 overflow-y-auto"
        data-channel-messages
      >
        {error && !messages ? (
          <p role="alert" className="m-6 rounded-xl bg-accent/10 px-4 py-3 text-sm text-accent">{error}</p>
        ) : !messages ? (
          <MessagesSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center" data-empty-channel>
            <span className="flex size-16 items-center justify-center rounded-3xl bg-accent/15 text-accent">
              <Hash className="size-8" />
            </span>
            <p className="font-display text-xl font-bold">Welcome to {channel.name}</p>
            <p className="max-w-sm text-sm text-muted">This is the very start of this channel. Say something to get it going.</p>
          </div>
        ) : (
          <div className="px-2 pb-4 pt-3">
            {hasMore && (
              <div className="pb-3 text-center">
                <button onClick={() => void older_()} disabled={loadingOlder} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted transition hover:border-white/25 hover:text-text disabled:opacity-60" data-older>
                  {loadingOlder ? <Loader2 className="size-3 animate-spin" /> : <ArrowUp className="size-3" />} Earlier messages
                </button>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1]
              const newDay = i === 0 || dayOf(prev.at) !== dayOf(m.at)
              const joined = !newDay && !!prev && !m.replyTo && prev.sender?.id === m.sender?.id && !prev.deleted === !m.deleted && (m.at ?? 0) - (prev.at ?? 0) < 5 * 60_000
              const mine = !!myId && m.sender?.id === myId
              const name = m.sender?.username ?? 'Someone who left'
              const gif = m.deleted ? null : gifOf(m.text)
              const fresh = !firstPaint.current && !seen.current.has(m.id)
              return (
                <div key={m.id}>
                  {newDay && (
                    <p className="my-4 flex items-center gap-3 px-4 text-[11px] font-semibold uppercase tracking-widest text-muted/80" data-day-separator>
                      <span className="h-px flex-1 bg-border" />
                      {dayLabel(m.at)}
                      <span className="h-px flex-1 bg-border" />
                    </p>
                  )}
                  <div className={cn('group relative flex gap-3 rounded-xl px-4 transition-colors hover:bg-white/[0.03]', joined ? 'py-0.5' : 'mt-3 py-1', fresh && 'message-in', picker === m.id && 'bg-white/[0.03]')} data-message={m.id} data-mine={mine} data-deleted={m.deleted}>
                    <div className="w-10 shrink-0">
                      {!joined ? <Avatar name={name} src={m.sender?.avatar} frame={styleOf(m.sender?.style)?.frame} size="md" /> : <span className="mt-1 hidden text-[10px] tabular-nums text-muted/70 group-hover:block">{timeOf(m.at)}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      {m.replyTo && (
                        <p className="mb-0.5 flex items-center gap-1.5 truncate text-xs text-muted" data-reply-quote>
                          <CornerUpLeft className="size-3 shrink-0" />
                          {m.replyTo.sender && <span className="font-semibold text-text/80">{m.replyTo.sender}</span>}
                          <span className="truncate italic">{m.replyTo.text}</span>
                        </p>
                      )}
                      {!joined && (
                        <p className="flex items-baseline gap-2 text-sm">
                          <UserName name={name} style={styleOf(m.sender?.style)} verified={m.sender?.verified} admin={m.sender?.admin} className="font-bold" />
                          <time className="text-[11px] text-muted" title={m.at ? new Date(m.at).toLocaleString() : undefined}>{timeOf(m.at)}</time>
                        </p>
                      )}
                      {m.deleted ? (
                        <p className="text-sm italic text-muted/70" data-message-deleted>This message was deleted.</p>
                      ) : editing?.id === m.id ? (
                        <div className="mt-1">
                          <textarea
                            value={editing.text}
                            onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setEditing(null)
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                void saveEdit()
                              }
                            }}
                            rows={Math.min(6, editing.text.split('\n').length + 1)}
                            autoFocus
                            aria-label="Edit your message"
                            className="w-full resize-none rounded-xl border border-accent bg-surface-2 px-3 py-2 text-sm outline-none"
                            data-edit-box
                          />
                          <p className="mt-1 text-[11px] text-muted">Enter to save · Escape to cancel</p>
                        </div>
                      ) : gif ? (
                        <ChatGif gif={gif} />
                      ) : bigEmoji(m.text) ? (
                        <p className="text-4xl leading-tight">{m.text.trim()}</p>
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text/90" data-message-text>
                          <LinkText text={m.text} />
                          {m.editedAt && <span className="ml-1.5 text-[10px] text-muted" title={`Edited ${new Date(m.editedAt).toLocaleString()}`} data-edited>(edited)</span>}
                        </p>
                      )}
                      {m.reactions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1" data-reactions>
                          {m.reactions.map((r) => (
                            <button key={r.emoji} onClick={() => void react(m, r.emoji)} className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition hover:-translate-y-0.5', r.mine ? 'border-accent/60 bg-accent/15 text-text' : 'border-border bg-surface-2 text-muted hover:border-white/25')} title={r.mine ? 'Take your reaction back' : 'React with this too'} data-reaction={r.emoji} data-reaction-mine={r.mine}>
                              <span className="text-sm leading-none">{r.emoji}</span>
                              <span className="font-bold tabular-nums">{r.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* What you can do with a message, when the mouse is on it. */}
                    {!m.deleted && editing?.id !== m.id && (
                      <div className={cn('absolute -top-3 right-4 z-10 items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5 shadow-xl', picker === m.id ? 'flex' : 'hidden group-hover:flex max-md:group-active:flex')} data-message-tools>
                        {QUICK.slice(0, 3).map((e) => (
                          <button key={e} onClick={() => void react(m, e)} className={cn(tool, 'text-sm leading-none')} title={`React ${e}`} data-quick-react={e}>
                            {e}
                          </button>
                        ))}
                        <button onClick={() => setPicker(picker === m.id ? null : m.id)} className={tool} aria-label="Add a reaction" title="Add a reaction" data-react data-emoji-toggle>
                          <SmilePlus className="size-4" />
                        </button>
                        <button onClick={() => setReplyTo(m)} className={tool} aria-label="Reply" title="Reply" data-reply>
                          <CornerUpLeft className="size-4" />
                        </button>
                        {mine && !gif && (
                          <button onClick={() => setEditing({ id: m.id, text: m.text })} className={tool} aria-label="Edit" title="Edit" data-edit>
                            <Pencil className="size-4" />
                          </button>
                        )}
                        {(mine || can(role, 'deleteMessages')) && (
                          <button onClick={() => void remove(m)} className={cn(tool, 'hover:text-accent')} aria-label="Delete" title={mine ? 'Delete' : 'Delete (you may remove messages here)'} data-delete>
                            <Trash2 className="size-4" />
                          </button>
                        )}
                        {picker === m.id && (
                          <EmojiPicker
                            className="absolute right-0 top-full z-20 mt-1"
                            onClose={() => setPicker(null)}
                            onPick={(e) => {
                              setPicker(null)
                              void react(m, e)
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {replyTo && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface-2/70 px-5 py-2 text-xs" data-replying>
          <CornerUpLeft className="size-3.5 shrink-0 text-accent" />
          <span className="text-muted">Replying to</span>
          <span className="font-bold">{replyTo.sender?.username ?? 'someone'}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{replyTo.text}</span>
          <button onClick={() => setReplyTo(null)} aria-label="Cancel the reply" className="rounded p-1 text-muted hover:bg-white/10 hover:text-text">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <ChatComposer placeholder={`Message ${channel.name}`} onSend={send} autoFocus focusKey={channel.id} />
    </section>
  )
}

// Opening a channel reads it: the lists learn about that.
export const channelRead = (): void => void refreshCommunities()
