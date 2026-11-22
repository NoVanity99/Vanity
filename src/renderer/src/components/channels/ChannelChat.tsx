import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowUp, CornerUpLeft, Download, FileText, Hash, Loader2, Lock, Megaphone, Pencil, RotateCw, SmilePlus, Trash2, Upload, X } from 'lucide-react'
import { can, fileSize, INLINE_AUDIO, INLINE_IMAGE, INLINE_VIDEO, LIMITS, type Attachment, type Channel, type ChannelMessage, type CommunityMember, type Role } from '@shared/communities'
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
import { api, dropPending, refreshCommunities, retryPending, sendLater, uploadFile, useChannelMessages, useFileBases, usePending } from '@/state/communities'
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

/** Message text with links made clickable and the @names of the people it mentions marked. */
function RichText({ text, mentions, myId }: { text: string; mentions: [string, string][]; myId: string | undefined }): React.JSX.Element {
  if (!mentions.length) return <LinkText text={text} />
  const byName = new Map(mentions.map(([id, name]) => [name.toLowerCase(), id]))
  const parts = text.split(/(@[A-Za-z0-9_]{3,20})/g)
  return (
    <>
      {parts.map((part, i) => {
        const id = part.startsWith('@') ? byName.get(part.slice(1).toLowerCase()) : undefined
        return id ? (
          <span key={i} className={cn('rounded px-1 py-0.5 font-semibold', id === myId ? 'bg-amber-400/25 text-amber-200' : 'bg-accent/15 text-accent')} data-mention={part.slice(1)}>
            {part}
          </span>
        ) : (
          <LinkText key={i} text={part} />
        )
      })}
    </>
  )
}

/** The pictures and files on a message: pictures, videos and sounds show right there; anything else is a card to open. */
function Attachments({ files, bases, onView }: { files: Attachment[]; bases: { show: string; open: string } | null; onView: (a: Attachment) => void }): React.JSX.Element | null {
  if (!files.length) return null
  const is = (list: readonly string[], a: Attachment): boolean => list.includes(a.type)
  const pictures = files.filter((a) => is(INLINE_IMAGE, a))
  const rest = files.filter((a) => !is(INLINE_IMAGE, a))
  const src = (a: Attachment): string | undefined => (bases ? bases.show + a.path : undefined)
  return (
    <div className="mt-1.5 space-y-1.5" data-attachments>
      {pictures.length > 0 && (
        <div className={cn('max-w-lg gap-1.5', pictures.length > 1 ? 'grid grid-cols-2' : 'flex')}>
          {pictures.map((a) => (
            <button key={a.id} onClick={() => onView(a)} title={`${a.name} · ${fileSize(a.size)}`} className="group/pic relative overflow-hidden rounded-xl border border-border bg-black/30 transition hover:border-white/30" data-attachment-image={a.name}>
              <img src={src(a)} alt={a.name} loading="lazy" draggable={false} className={cn('object-cover transition duration-300 group-hover/pic:scale-[1.02]', pictures.length > 1 ? 'aspect-square w-full' : 'max-h-80 w-auto max-w-full object-contain')} />
            </button>
          ))}
        </div>
      )}
      {rest.map((a) =>
        is(INLINE_VIDEO, a) ? (
          <video key={a.id} src={src(a)} controls preload="metadata" className="max-h-80 max-w-lg rounded-xl border border-border bg-black" data-attachment-video={a.name} />
        ) : (
          <div key={a.id} className="flex max-w-md items-center gap-3 rounded-xl border border-border bg-surface-2/70 px-3 py-2.5 transition hover:border-white/25" data-attachment-file={a.name}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <FileText className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{a.name}</span>
              <span className="block text-[11px] text-muted">{fileSize(a.size)}</span>
              {is(INLINE_AUDIO, a) && <audio src={src(a)} controls preload="none" className="mt-1.5 h-8 w-full" />}
            </span>
            {bases && (
              <a href={bases.open + a.path} target="_blank" rel="noreferrer noopener" title="Open in your browser to save it" aria-label={`Download ${a.name}`} className="rounded-lg p-2 text-muted transition hover:bg-white/10 hover:text-text" data-attachment-download>
                <Download className="size-4" />
              </a>
            )}
          </div>
        )
      )}
    </div>
  )
}

/** A file chosen for the next message: on its way up, up, or failed. */
interface Staged {
  key: string
  file: File
  progress: number
  attachment: Attachment | null
  error: string | null
  preview: string | null
}

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
export function ChannelChat({ channel, role, myId, members, filesEnabled, headerStart, headerEnd }: { channel: Channel; role: Role; myId: string | undefined; members: CommunityMember[] | null; filesEnabled: boolean; headerStart?: React.ReactNode; headerEnd?: React.ReactNode }): React.JSX.Element {
  const toast = useToast()
  const { messages, hasMore, error, typing, loadingOlder, older, put } = useChannelMessages(channel.id)
  const pending = usePending(channel.id)
  const bases = useFileBases()
  const [staged, setStaged] = useState<Staged[]>([])
  const [viewing, setViewing] = useState<Attachment | null>(null)
  const [dropping, setDropping] = useState(false)
  const gone = useRef(new Set<string>())
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
    setViewing(null)
    setDropping(false)
    // Files chosen for a message that was never sent are taken back.
    setStaged((prev) => {
      for (const f of prev) {
        gone.current.add(f.key)
        if (f.preview) URL.revokeObjectURL(f.preview)
        if (f.attachment) void api('DELETE', `/uploads/${f.attachment.id}`).catch(() => {})
      }
      return []
    })
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
  }, [messages, pending.length])

  const fail = (e: unknown): void => toast(e instanceof Error ? e.message : 'That did not work.', 'error')
  // A message is shown at once as "Sending…" and goes out as soon as it can: with no connection
  // it waits, even through a restart (see state/communities.ts).
  const send = async (text: string): Promise<boolean> => {
    const ready = staged.filter((f) => f.attachment)
    // A GIF goes on its own; files wait for the next written message.
    const withFiles = !gifOf(text) ? ready : []
    sendLater({ channelId: channel.id, text, replyTo: replyTo ? { id: replyTo.id, sender: replyTo.sender?.username ?? '', text: replyTo.text.slice(0, 140) } : null, attachments: withFiles.map((f) => f.attachment!) })
    atBottom.current = true
    setReplyTo(null)
    if (withFiles.length) {
      for (const f of withFiles) if (f.preview) URL.revokeObjectURL(f.preview)
      setStaged((prev) => prev.filter((f) => !withFiles.includes(f)))
    }
    return true
  }
  const addFiles = (files: File[]): void => {
    const room = LIMITS.attachments - staged.length
    if (files.length > room) toast(`A message can carry up to ${LIMITS.attachments} files.`, 'error')
    for (const file of files.slice(0, Math.max(0, room))) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const item: Staged = { key, file, progress: 0, attachment: null, error: null, preview: (INLINE_IMAGE as readonly string[]).includes(file.type) ? URL.createObjectURL(file) : null }
      setStaged((prev) => [...prev, item])
      const change = (patch: Partial<Staged>): void => setStaged((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)))
      uploadFile(channel.id, file, (progress) => change({ progress }), () => gone.current.has(key)).then(
        (attachment) => (gone.current.has(key) ? void api('DELETE', `/uploads/${attachment.id}`).catch(() => {}) : change({ attachment, progress: 1 })),
        (e: unknown) => gone.current.has(key) || change({ error: e instanceof Error ? e.message : "That file didn't upload." })
      )
    }
  }
  const unstage = (f: Staged): void => {
    gone.current.add(f.key)
    if (f.preview) URL.revokeObjectURL(f.preview)
    if (f.attachment) void api('DELETE', `/uploads/${f.attachment.id}`).catch(() => {})
    setStaged((prev) => prev.filter((x) => x.key !== f.key))
  }
  const uploading = staged.some((f) => !f.attachment && !f.error)
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
      put({ ...m, deleted: true, text: '', reactions: [], attachments: [], mentions: [], mentionsMe: false, editedAt: null })
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
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-channel-chat={channel.name}
      onDragEnter={(e) => filesEnabled && channel.canPost && e.dataTransfer.types.includes('Files') && setDropping(true)}
      onDragOver={(e) => filesEnabled && channel.canPost && e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node | null) || setDropping(false)}
      onDrop={(e) => {
        if (!filesEnabled || !channel.canPost || !e.dataTransfer.files.length) return
        e.preventDefault()
        setDropping(false)
        addFiles([...e.dataTransfer.files])
      }}
    >
      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent bg-bg/85 text-accent backdrop-blur" data-drop-zone>
          <Upload className="size-10" />
          <p className="font-display text-lg font-bold">Drop to attach to {channel.name}</p>
        </div>
      )}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface/60 px-5 backdrop-blur max-md:px-2">
        {headerStart}
        {channel.restricted === 'view' ? <Lock className="size-4 shrink-0 text-muted" /> : channel.restricted === 'post' ? <Megaphone className="size-4 shrink-0 text-muted" /> : <Hash className="size-4 shrink-0 text-muted" />}
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
        ) : messages.length === 0 && pending.length === 0 ? (
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
                  <div className={cn('group relative flex gap-3 rounded-xl px-4 transition-colors hover:bg-white/[0.03]', joined ? 'py-0.5' : 'mt-3 py-1', fresh && 'message-in', picker === m.id && 'bg-white/[0.03]', m.mentionsMe && 'bg-amber-400/[0.07] shadow-[inset_3px_0_0] shadow-amber-400 hover:bg-amber-400/10')} data-message={m.id} data-mine={mine} data-deleted={m.deleted} data-mentions-me={m.mentionsMe}>
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
                          <span style={m.color ? { color: m.color } : undefined} data-name-color={m.color ?? undefined}>
                            <UserName name={name} style={styleOf(m.sender?.style)} verified={m.sender?.verified} admin={m.sender?.admin} className="font-bold" />
                          </span>
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
                      ) : m.text ? (
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text/90" data-message-text>
                          <RichText text={m.text} mentions={m.mentions} myId={myId} />
                          {m.editedAt && <span className="ml-1.5 text-[10px] text-muted" title={`Edited ${new Date(m.editedAt).toLocaleString()}`} data-edited>(edited)</span>}
                        </p>
                      ) : null}
                      {!m.deleted && <Attachments files={m.attachments} bases={bases} onView={setViewing} />}
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
            {/* Yours, on their way: shown at once, and sent as soon as there is a connection. */}
            {pending.map((p) => (
              <div key={p.nonce} className={cn('message-in relative mt-3 flex gap-3 rounded-xl px-4 py-1', p.failed ? 'bg-accent/[0.06]' : 'opacity-60')} data-pending={p.failed ? 'failed' : 'sending'}>
                <div className="flex w-10 shrink-0 justify-center pt-1">{p.failed ? <AlertCircle className="size-5 text-accent" /> : <Loader2 className="size-5 animate-spin text-muted" />}</div>
                <div className="min-w-0 flex-1">
                  {p.replyTo && (
                    <p className="mb-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                      <CornerUpLeft className="size-3 shrink-0" />
                      <span className="font-semibold text-text/80">{p.replyTo.sender}</span>
                      <span className="truncate italic">{p.replyTo.text}</span>
                    </p>
                  )}
                  {gifOf(p.text) ? <ChatGif gif={gifOf(p.text)!} /> : p.text && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text/90">{p.text}</p>}
                  <Attachments files={p.attachments} bases={bases} onView={setViewing} />
                  {p.failed ? (
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-accent" role="alert">
                      Not sent: {p.failed}
                      <button onClick={() => retryPending(p.nonce)} className="inline-flex items-center gap-1 font-bold underline-offset-2 hover:underline" data-pending-retry>
                        <RotateCw className="size-3" /> Try again
                      </button>
                      <button onClick={() => dropPending(p.nonce)} className="font-bold text-muted underline-offset-2 hover:text-text hover:underline" data-pending-drop>
                        Delete
                      </button>
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-muted" data-sending>Sending…</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className={cn('h-5 shrink-0 truncate px-5 text-[11px] text-muted transition-opacity duration-200', typing.length ? 'opacity-100' : 'opacity-0')} aria-live="polite" data-typing={typing.join(',')}>
        {typing.length > 0 && (
          <>
            <span className="mr-1.5 inline-flex gap-0.5 align-middle">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </span>
            <span className="font-semibold text-text/80">{typing.length > 3 ? 'Several people' : typing.join(typing.length === 2 ? ' and ' : ', ')}</span> {typing.length === 1 ? 'is' : 'are'} typing…
          </>
        )}
      </p>

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
      {staged.length > 0 && (
        <ul className="thin-scroll flex shrink-0 gap-2 overflow-x-auto border-t border-border bg-surface-2/50 px-4 py-2.5" data-staged>
          {staged.map((f) => (
            <li key={f.key} className={cn('relative flex w-40 shrink-0 flex-col gap-1.5 rounded-xl border bg-surface p-2', f.error ? 'border-accent/60' : 'border-border')} data-staged-file={f.file.name} data-staged-state={f.error ? 'failed' : f.attachment ? 'ready' : 'uploading'}>
              {f.preview ? <img src={f.preview} alt="" className="h-20 w-full rounded-lg object-cover" /> : <span className="flex h-20 items-center justify-center rounded-lg bg-white/5 text-muted"><FileText className="size-7" /></span>}
              <span className="truncate text-xs font-semibold" title={f.file.name}>{f.file.name}</span>
              {f.error ? (
                <span className="line-clamp-2 text-[10px] leading-tight text-accent" role="alert">{f.error}</span>
              ) : (
                <span className="flex items-center gap-1.5 text-[10px] text-muted">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                    <span className={cn('block h-full rounded-full transition-all duration-300', f.attachment ? 'bg-emerald-400' : 'bg-accent')} style={{ width: `${Math.round((f.attachment ? 1 : f.progress) * 100)}%` }} />
                  </span>
                  {f.attachment ? fileSize(f.file.size) : `${Math.round(f.progress * 100)}%`}
                </span>
              )}
              <button onClick={() => unstage(f)} aria-label={`Remove ${f.file.name}`} title="Remove" className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-surface-2 p-1 text-muted shadow-lg transition hover:text-text" data-unstage>
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {channel.canPost ? (
        <ChatComposer
          placeholder={`Message ${channel.name}`}
          onSend={send}
          autoFocus
          focusKey={channel.id}
          mentionables={(members ?? []).filter((m) => m.user.id !== myId).map((m) => ({ id: m.user.id, username: m.user.username, avatar: m.user.avatar }))}
          onTyping={() => void api('POST', `/channels/${channel.id}/typing`).catch(() => {})}
          onFiles={filesEnabled ? addFiles : undefined}
          canSendEmpty={staged.some((f) => f.attachment)}
          busy={uploading}
        />
      ) : (
        <p className="flex shrink-0 items-center justify-center gap-2 border-t border-border px-4 py-4 text-sm text-muted" data-read-only>
          <Megaphone className="size-4" /> Only certain roles can write in this channel.
        </p>
      )}

      {viewing && bases && (
        <div className="fixed inset-0 z-[60] flex animate-[fade-in_150ms_ease-out] flex-col items-center justify-center gap-3 bg-black/85 p-6 backdrop-blur-md" onClick={() => setViewing(null)} role="dialog" aria-label={viewing.name} data-image-viewer>
          <img src={bases.show + viewing.path} alt={viewing.name} className="max-h-[85%] max-w-full animate-[dialog-in_200ms_ease-out] rounded-xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
          <p className="flex items-center gap-3 text-sm text-white/80" onClick={(e) => e.stopPropagation()}>
            <span className="max-w-xs truncate">{viewing.name}</span>
            <span className="text-white/50">{fileSize(viewing.size)}</span>
            <a href={bases.open + viewing.path} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 font-semibold transition hover:bg-white/20">
              <Download className="size-4" /> Open in browser
            </a>
          </p>
          <button onClick={() => setViewing(null)} aria-label="Close" className="absolute right-5 top-12 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20">
            <X className="size-5" />
          </button>
        </div>
      )}
    </section>
  )
}

// Opening a channel reads it: the lists learn about that.
export const channelRead = (): void => void refreshCommunities()
