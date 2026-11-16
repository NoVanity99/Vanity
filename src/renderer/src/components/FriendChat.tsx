import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, AudioLines, CheckCheck, Loader2, MessageCircle, SendHorizontal, Smile } from 'lucide-react'
import type { ChatMessage, Friend } from '@shared/types'
import { cn } from '@/lib/cn'
import { useNavigate } from 'react-router-dom'
import { EmojiPicker } from '@/components/EmojiPicker'
import { isVoiceInvite, voice } from '@/state/voice'
import { bigEmoji, replaceEmoticon } from '@/lib/emoji'
import { refreshFriends, useFriends, watchChat } from '@/state/friends'

const POLL_MS = 4000

const MAX = 2000

const dayOf = (at: number | null): string => (at ? new Date(at).toDateString() : '')
function dayLabel(at: number | null): string {
  if (!at) return ''
  const d = new Date(at)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
const timeOf = (at: number | null): string => (at ? new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '')

/**
 * The chat with one friend. Messages are kept on Vanity's server for good, so the whole
 * history is here on every device: the newest page loads first and "Earlier messages"
 * pages back. New messages arrive by themselves every few seconds while it is open.
 */
export function FriendChat({
  friend,
  className,
  autoFocus = false,
  header
}: {
  friend: Pick<Friend, 'id' | 'username'>
  className?: string
  autoFocus?: boolean
  /** Replaces the plain title bar (the pop-up has its own, with minimize and close). */
  header?: React.ReactNode
}): React.JSX.Element {
  const [emojiOpen, setEmojiOpen] = useState(false)
  const navigate = useNavigate()
  // The friend's voice room right now, for the Join button under an invite.
  const theirVoice = useFriends()?.friends.find((f) => f.id === friend.id)?.voice ?? null
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [more, setMore] = useState(false)
  const [seenUpTo, setSeenUpTo] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  // Whether the view is at the newest message: only then does a new one pull it down.
  const atBottom = useRef(true)
  const lastId = useRef(0)

  const merge = useCallback((incoming: ChatMessage[], where: 'end' | 'start') => {
    setMessages((prev) => {
      const have = new Set((prev ?? []).map((m) => m.id))
      const fresh = incoming.filter((m) => !have.has(m.id))
      const next = where === 'end' ? [...(prev ?? []), ...fresh] : [...fresh, ...(prev ?? [])]
      lastId.current = next.length ? next[next.length - 1].id : 0
      return next
    })
  }, [])

  // First page, then anything newer every few seconds.
  useEffect(() => {
    let cancelled = false
    setMessages(null)
    setError(null)
    setMore(false)
    lastId.current = 0
    atBottom.current = true
    const first = async (): Promise<void> => {
      const r = await window.vanity.friends.messages(friend.id).catch(() => null)
      if (cancelled) return
      if (!r) return setError("Couldn't load the chat. Check your connection.")
      if (r.error !== undefined) return setError(r.error)
      setMore(r.data.more)
      setSeenUpTo(r.data.seenUpTo)
      setMessages([])
      merge(r.data.messages, 'end')
      // Opening the chat read their messages: the unread count elsewhere can drop now.
      void refreshFriends()
    }
    const poll = async (): Promise<void> => {
      if (document.hidden) return
      if (!lastId.current && error) return void first()
      const r = await window.vanity.friends.messages(friend.id, { after: lastId.current }).catch(() => null)
      if (cancelled || !r || r.error !== undefined) return
      setSeenUpTo(r.data.seenUpTo)
      if (r.data.messages.length) {
        merge(r.data.messages, 'end')
        if (r.data.messages.some((m) => !m.mine)) void refreshFriends()
      }
    }
    void first()
    const timer = setInterval(() => void poll(), POLL_MS)
    const unwatch = watchChat(friend.id)
    return () => {
      cancelled = true
      clearInterval(timer)
      unwatch()
    }
  }, [friend.id, merge]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stay on the newest message when one arrives (unless you scrolled up to read).
  useLayoutEffect(() => {
    const el = box.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus, friend.id])

  const older = async (): Promise<void> => {
    const el = box.current
    if (!messages?.length || loadingOlder) return
    setLoadingOlder(true)
    const heightBefore = el?.scrollHeight ?? 0
    const r = await window.vanity.friends.messages(friend.id, { before: messages[0].id }).catch(() => null)
    setLoadingOlder(false)
    if (!r || r.error !== undefined) return
    atBottom.current = false
    setMore(r.data.more)
    merge(r.data.messages, 'start')
    // Keep what you were reading where it was.
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - heightBefore
    })
  }

  const send = async (): Promise<void> => {
    const body = text.trim()
    if (!body || sending || [...body].length > MAX) return
    setSending(true)
    setError(null)
    const r = await window.vanity.friends.send(friend.id, body).catch(() => null)
    setSending(false)
    if (!r) return setError("Couldn't send that. Check your connection and try again.")
    if (r.error !== undefined) return setError(r.error)
    setText('')
    atBottom.current = true
    merge([r.data], 'end')
    input.current?.focus()
  }

  const length = [...text.trim()].length
  const lastMine = messages ? [...messages].reverse().find((m) => m.mine) : undefined

  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface', className)} data-friend-chat>
      {header ?? (
        <h2 className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5 text-sm font-semibold uppercase tracking-widest text-muted">
          <MessageCircle className="size-4" /> Chat with {friend.username}
        </h2>
      )}

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
            <MessageCircle className="size-8 opacity-40" />
            <p>No messages yet. Say hi to {friend.username}!</p>
            <p className="max-w-xs text-xs">Your chat is saved for good and follows you to every device.</p>
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
            {!more && messages && messages.length > 0 && <p className="pb-2 text-center text-[11px] text-muted/70">This is the start of your chat with {friend.username}.</p>}
            {messages?.map((m, i) => {
              const newDay = i === 0 || dayOf(messages[i - 1].at) !== dayOf(m.at)
              const joined = !newDay && i > 0 && messages[i - 1].mine === m.mine && (m.at ?? 0) - (messages[i - 1].at ?? 0) < 5 * 60_000
              return (
                <div key={m.id}>
                  {newDay && (
                    <p className="my-3 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-widest text-muted/80">
                      <span className="h-px flex-1 bg-border" />
                      {dayLabel(m.at)}
                      <span className="h-px flex-1 bg-border" />
                    </p>
                  )}
                  <div className={cn('flex', m.mine ? 'justify-end' : 'justify-start', joined ? 'mt-0.5' : 'mt-2')} data-message={m.mine ? 'mine' : 'theirs'}>
                    {bigEmoji(m.text) ? (
                      // Just emoji: shown big, without a bubble.
                      <div title={m.at ? new Date(m.at).toLocaleString() : undefined} className={cn('flex items-end gap-2', m.mine && 'flex-row-reverse')} data-big-emoji>
                        <span className="text-4xl leading-tight">{m.text.trim()}</span>
                        <span className="pb-1 text-[10px] tabular-nums text-muted">{timeOf(m.at)}</span>
                      </div>
                    ) : (
                      <div
                        title={m.at ? new Date(m.at).toLocaleString() : undefined}
                        className={cn(
                          'max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                          m.mine ? 'rounded-br-md bg-accent text-white' : 'rounded-bl-md bg-surface-2 text-text'
                        )}
                      >
                        {m.text}
                        <span className={cn('ml-2 inline-block translate-y-0.5 text-[10px] tabular-nums', m.mine ? 'text-white/70' : 'text-muted')}>{timeOf(m.at)}</span>
                        {!m.mine && isVoiceInvite(m.text) && (
                          <button
                            disabled={!theirVoice?.canJoin}
                            onClick={() => {
                              if (!theirVoice) return
                              void voice.join(theirVoice.roomId)
                              navigate('/voice')
                            }}
                            data-join-invite
                            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:bg-white/10 disabled:text-muted"
                          >
                            <AudioLines className="size-4" /> {theirVoice?.canJoin ? 'Join voice room' : theirVoice ? 'Room is full or locked' : 'Not in voice anymore'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {m.mine && lastMine?.id === m.id && seenUpTo !== null && seenUpTo >= m.id && (
                    <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted" data-seen>
                      <CheckCheck className="size-3.5 text-sky-400" /> Seen
                    </p>
                  )}
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
      <form
        className="relative flex shrink-0 items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <textarea
          ref={input}
          value={text}
          onChange={(e) => {
            // A typed face like :) becomes its emoji once a space follows it.
            const el = e.target
            const swapped = replaceEmoticon(el.value, el.selectionStart ?? el.value.length)
            if (!swapped) return setText(el.value)
            setText(swapped.text)
            requestAnimationFrame(() => el.setSelectionRange(swapped.cursor, swapped.cursor))
          }}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter makes a new line.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          rows={Math.min(5, Math.max(1, text.split('\n').length))}
          placeholder={`Message ${friend.username}`}
          aria-label={`Message ${friend.username}`}
          className="min-h-10 flex-1 resize-none rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
        />
        <button
          type="button"
          data-emoji-toggle
          onClick={() => setEmojiOpen((v) => !v)}
          aria-label="Emoji"
          aria-expanded={emojiOpen}
          title="Emoji"
          className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl border border-border transition hover:border-white/25 hover:text-text', emojiOpen ? 'bg-accent/15 text-text' : 'text-muted')}
        >
          <Smile className="size-5" />
        </button>
        {emojiOpen && (
          <EmojiPicker
            className="absolute bottom-full right-2 z-20 mb-2"
            onClose={() => setEmojiOpen(false)}
            onPick={(e) => {
              // At the cursor, or the end.
              const el = input.current
              const at = el ? el.selectionStart : text.length
              const end = el ? el.selectionEnd : text.length
              const next = text.slice(0, at) + e + text.slice(end)
              setText(next)
              requestAnimationFrame(() => {
                el?.focus()
                el?.setSelectionRange(at + e.length, at + e.length)
              })
            }}
          />
        )}
        {length > MAX - 200 && <span className={cn('pb-2.5 text-[11px] tabular-nums', length > MAX ? 'font-semibold text-accent' : 'text-muted')}>{MAX - length}</span>}
        <button
          type="submit"
          disabled={!length || length > MAX || sending}
          aria-label="Send"
          title="Send (Enter)"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
        </button>
      </form>
    </section>
  )
}
