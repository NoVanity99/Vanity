import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Loader2, Paperclip, SendHorizontal, Smile } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { gifMessage } from '@shared/groups'
import { EmojiPicker } from '@/components/EmojiPicker'
import { cn } from '@/lib/cn'
import { replaceEmoticon } from '@/lib/emoji'
import { GifPicker } from './GifPicker'

const MAX = 2000

/**
 * Where you write in a chat (friend or group): text with emoji, a GIF button, and send.
 * `onSend` sends one message and says whether it worked (an error is shown above by the chat).
 */
export interface ComposerExtras {
  /** People who can be named with @ (a list appears as you type the name). */
  mentionables?: { id: string; username: string; avatar: string | null }[]
  /** Called now and then while writing. */
  onTyping?: () => void
  /** Files were chosen, pasted or dropped: shows the attach button. */
  onFiles?: (files: File[]) => void
  /** There is something to send besides text (files waiting), so an empty box may be sent. */
  canSendEmpty?: boolean
  /** Sending is held back for now (files still uploading). */
  busy?: boolean
}

export function ChatComposer({ placeholder, onSend, autoFocus, focusKey, mentionables, onTyping, onFiles, canSendEmpty, busy }: { placeholder: string; onSend: (text: string) => Promise<boolean>; autoFocus?: boolean; focusKey?: string } & ComposerExtras): React.JSX.Element {
  const [text, setText] = useState('')
  // "@jo" being typed: where it starts, and which suggestion is picked.
  const [mention, setMention] = useState<{ at: number; query: string; pick: number } | null>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const lastTyping = useRef(0)
  const [sending, setSending] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [gifOpen, setGifOpen] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus, focusKey])

  const found = mention && mentionables ? mentionables.filter((m) => m.username.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 6) : []
  // A name already written out in full needs no list (and Enter should send, not pick).
  const matches = found.length === 1 && found[0].username.toLowerCase() === mention?.query.toLowerCase() ? [] : found
  // Where the cursor goes once a picked name is in the box: set as the text lands, so letters
  // typed straight after it stay in order.
  const cursorAfter = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (cursorAfter.current === null) return
    input.current?.focus()
    input.current?.setSelectionRange(cursorAfter.current, cursorAfter.current)
    cursorAfter.current = null
  }, [text])
  /** Looks at the word under the cursor: an @ at its start opens the list of names. */
  const watchMention = (value: string, cursor: number): void => {
    if (!mentionables) return
    const found = /(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{0,20})$/.exec(value.slice(0, cursor))
    setMention(found ? { at: cursor - found[2].length - 1, query: found[2], pick: 0 } : null)
  }
  const pickMention = (username: string): void => {
    if (!mention) return
    const el = input.current
    const end = el?.selectionStart ?? text.length
    const next = `${text.slice(0, mention.at)}@${username} ${text.slice(end)}`
    cursorAfter.current = mention.at + username.length + 2
    setText(next)
    setMention(null)
  }

  const send = async (body = text.trim(), keepText = false): Promise<void> => {
    if ((!body && !(canSendEmpty && !keepText)) || sending || busy || [...body].length > MAX) return
    setMention(null)
    setSending(true)
    const ok = await onSend(body)
    setSending(false)
    if (ok && !keepText) setText('')
    input.current?.focus()
  }

  const length = [...text.trim()].length
  const toggle = 'flex size-10 shrink-0 items-center justify-center rounded-xl border border-border transition hover:border-white/25 hover:text-text'

  return (
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
          if (onTyping && el.value.trim() && Date.now() - lastTyping.current > 3000) {
            lastTyping.current = Date.now()
            onTyping()
          }
          watchMention(el.value, el.selectionStart ?? el.value.length)
          const swapped = replaceEmoticon(el.value, el.selectionStart ?? el.value.length)
          if (!swapped) return setText(el.value)
          setText(swapped.text)
          requestAnimationFrame(() => el.setSelectionRange(swapped.cursor, swapped.cursor))
        }}
        onKeyDown={(e) => {
          // With the list of names open, the arrows move through it and Enter or Tab picks.
          if (mention && matches.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              return setMention({ ...mention, pick: (mention.pick + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length })
            }
            if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
              e.preventDefault()
              return pickMention(matches[Math.min(mention.pick, matches.length - 1)].username)
            }
            if (e.key === 'Escape') {
              e.stopPropagation()
              return setMention(null)
            }
          }
          // Enter sends; Shift+Enter makes a new line.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void send()
          }
        }}
        onPaste={(e) => {
          // A copied picture (a screenshot, say) is attached rather than pasted as nothing.
          const pasted = onFiles ? [...e.clipboardData.files] : []
          if (!pasted.length) return
          e.preventDefault()
          onFiles!(pasted)
        }}
        onBlur={() => setTimeout(() => setMention(null), 150)}
        rows={Math.min(5, Math.max(1, text.split('\n').length))}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
      />
      {mention && matches.length > 0 && (
        <ul role="listbox" aria-label="People to mention" className="absolute bottom-full left-3 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-border bg-surface-2 p-1 shadow-2xl shadow-black/50" data-mention-list>
          {matches.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === mention.pick}>
              <button type="button" onMouseDown={(e) => (e.preventDefault(), pickMention(m.username))} onMouseEnter={() => setMention({ ...mention, pick: i })} className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition', i === mention.pick ? 'bg-accent/20 text-text' : 'text-muted')} data-mention-option={m.username}>
                <Avatar name={m.username} src={m.avatar} size="sm" />
                <span className="truncate font-semibold">{m.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {onFiles && (
        <>
          <input
            ref={filePicker}
            type="file"
            multiple
            hidden
            data-attach-input
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])]
              e.target.value = ''
              if (picked.length) onFiles(picked)
            }}
          />
          <button type="button" data-attach onClick={() => filePicker.current?.click()} aria-label="Attach a picture or file" title="Attach a picture or file (up to 25 MB each)" className={cn(toggle, 'text-muted')}>
            <Paperclip className="size-5" />
          </button>
        </>
      )}
      <button type="button" data-gif-toggle onClick={() => (setGifOpen((v) => !v), setEmojiOpen(false))} aria-label="GIFs" aria-expanded={gifOpen} title="GIFs" className={cn(toggle, 'text-[11px] font-black tracking-wide', gifOpen ? 'bg-accent/15 text-text' : 'text-muted')}>
        GIF
      </button>
      <button type="button" data-emoji-toggle onClick={() => (setEmojiOpen((v) => !v), setGifOpen(false))} aria-label="Emoji" aria-expanded={emojiOpen} title="Emoji" className={cn(toggle, emojiOpen ? 'bg-accent/15 text-text' : 'text-muted')}>
        <Smile className="size-5" />
      </button>
      {gifOpen && (
        <GifPicker
          className="absolute bottom-full right-2 z-20 mb-2"
          onClose={() => setGifOpen(false)}
          onPick={(gif) => {
            setGifOpen(false)
            // A GIF goes on its own, leaving anything you were typing in the box.
            void send(gifMessage(gif), true)
          }}
        />
      )}
      {emojiOpen && (
        <EmojiPicker
          className="absolute bottom-full right-2 z-20 mb-2"
          onClose={() => setEmojiOpen(false)}
          onPick={(e) => {
            // At the cursor, or the end.
            const el = input.current
            const at = el ? el.selectionStart : text.length
            const end = el ? el.selectionEnd : text.length
            setText(text.slice(0, at) + e + text.slice(end))
            requestAnimationFrame(() => {
              el?.focus()
              el?.setSelectionRange(at + e.length, at + e.length)
            })
          }}
        />
      )}
      {length > MAX - 200 && <span className={cn('pb-2.5 text-[11px] tabular-nums', length > MAX ? 'font-semibold text-accent' : 'text-muted')}>{MAX - length}</span>}
      <button type="submit" disabled={(!length && !canSendEmpty) || length > MAX || sending || busy} aria-label="Send" title="Send (Enter)" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition hover:brightness-110 disabled:opacity-40">
        {sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
      </button>
    </form>
  )
}
