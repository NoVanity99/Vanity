import { useEffect, useRef, useState } from 'react'
import { Loader2, SendHorizontal, Smile } from 'lucide-react'
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
export function ChatComposer({ placeholder, onSend, autoFocus, focusKey }: { placeholder: string; onSend: (text: string) => Promise<boolean>; autoFocus?: boolean; focusKey?: string }): React.JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [gifOpen, setGifOpen] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus, focusKey])

  const send = async (body = text.trim(), keepText = false): Promise<void> => {
    if (!body || sending || [...body].length > MAX) return
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
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
      />
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
      <button type="submit" disabled={!length || length > MAX || sending} aria-label="Send" title="Send (Enter)" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition hover:brightness-110 disabled:opacity-40">
        {sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
      </button>
    </form>
  )
}
