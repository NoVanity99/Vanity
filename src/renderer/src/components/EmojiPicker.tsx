import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/cn'
import { EMOJI_GROUPS, recentEmoji, rememberEmoji } from '@/lib/emoji'

/** A panel of emoji by group, with the ones you used last first. Picking one doesn't close it, so several can be added. */
export function EmojiPicker({ onPick, onClose, className }: { onPick: (emoji: string) => void; onClose: () => void; className?: string }): React.JSX.Element {
  const [recent, setRecent] = useState(recentEmoji)
  const [group, setGroup] = useState(recent.length ? 'recent' : EMOJI_GROUPS[0].id)
  const panel = useRef<HTMLDivElement>(null)

  // A click anywhere else, or Escape, closes it.
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      const t = e.target as Node
      if (panel.current && !panel.current.contains(t) && !(t instanceof Element && t.closest('[data-emoji-toggle]'))) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  const list = group === 'recent' ? recent : (EMOJI_GROUPS.find((g) => g.id === group)?.emoji ?? [])
  const pick = (e: string): void => {
    rememberEmoji(e)
    setRecent(recentEmoji())
    onPick(e)
  }

  return (
    <div ref={panel} role="dialog" aria-label="Emoji" data-emoji-picker className={cn('flex w-[300px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-surface shadow-2xl shadow-black/60', className)}>
      <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border p-1.5 [scrollbar-width:none]" role="tablist">
        {recent.length > 0 && (
          <button role="tab" aria-selected={group === 'recent'} title="Used lately" onClick={() => setGroup('recent')} className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg transition', group === 'recent' ? 'bg-accent/20 text-text' : 'text-muted hover:bg-white/10')}>
            <Clock className="size-4" />
          </button>
        )}
        {EMOJI_GROUPS.map((g) => (
          <button key={g.id} role="tab" aria-selected={group === g.id} title={g.label} onClick={() => setGroup(g.id)} className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg text-lg transition', group === g.id ? 'bg-accent/20' : 'opacity-70 hover:bg-white/10 hover:opacity-100')}>
            {g.icon}
          </button>
        ))}
      </div>
      <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted">{group === 'recent' ? 'Used lately' : EMOJI_GROUPS.find((g) => g.id === group)?.label}</p>
      <div className="grid h-52 grid-cols-8 content-start gap-0.5 overflow-y-auto p-2 pt-1 [scrollbar-width:thin]">
        {list.map((e) => (
          <button key={e} type="button" onClick={() => pick(e)} aria-label={e} data-emoji={e} className="flex size-8 items-center justify-center rounded-lg text-xl transition hover:scale-110 hover:bg-white/10">
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}
