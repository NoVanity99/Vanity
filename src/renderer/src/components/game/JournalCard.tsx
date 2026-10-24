import { useEffect, useRef, useState } from 'react'
import { NotebookPen, Star } from 'lucide-react'
import { PLAY_STATUS_LABELS, PLAY_STATUSES, type Game, type GamePatch } from '@shared/types'
import { cn } from '@/lib/cn'
import { STATUS_STYLES } from '@/lib/status'
import { Section } from './parts'

/** Your own status, star rating and private notes for a game. */
export function JournalCard({ game, onChange, delay }: { game: Game; onChange: (patch: GamePatch) => void; delay?: number }): React.JSX.Element {
  const [notes, setNotes] = useState(game.notes ?? '')
  const [hoverStar, setHoverStar] = useState(0)
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(notes)
  latest.current = notes

  // Another game page reuses this component: start from that game's notes.
  useEffect(() => setNotes(game.notes ?? ''), [game.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveNotes = (value: string): void => {
    clearTimeout(timer.current)
    if (value === (game.notes ?? '')) return
    onChange({ notes: value })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }
  // Save shortly after typing stops, and when leaving the page.
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    return () => {
      if (latest.current !== (game.notes ?? '')) onChange({ notes: latest.current })
    }
  }, [game.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const rating = game.userRating ?? 0
  const shown = hoverStar || rating
  return (
    <Section icon={NotebookPen} title="Your journal" delay={delay}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Status</p>
      <div className="flex flex-wrap gap-1.5">
        {PLAY_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => onChange({ playStatus: game.playStatus === s ? null : s })}
            aria-pressed={game.playStatus === s}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition',
              game.playStatus === s ? STATUS_STYLES[s] : 'text-muted ring-white/10 hover:text-text hover:ring-white/25'
            )}
          >
            {PLAY_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted">Your rating</p>
      <div className="flex items-center gap-1" onMouseLeave={() => setHoverStar(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onMouseEnter={() => setHoverStar(n)}
            onClick={() => onChange({ userRating: rating === n ? null : n })}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            aria-pressed={rating === n}
            className="rounded p-0.5 transition hover:scale-110"
          >
            <Star className={cn('size-6 transition-colors', n <= shown ? 'fill-amber-400 text-amber-400' : 'text-white/20')} />
          </button>
        ))}
        {rating > 0 && <span className="ml-2 text-sm text-muted">{['', 'Not for me', 'It was OK', 'Liked it', 'Really liked it', 'Loved it'][rating]}</span>}
      </div>

      <div className="mb-2 mt-5 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Notes</p>
        <span className={cn('text-xs text-emerald-400 transition-opacity', saved ? 'opacity-100' : 'opacity-0')}>Saved</span>
      </div>
      <textarea
        value={notes}
        onChange={(e) => {
          const v = e.target.value
          setNotes(v)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => saveNotes(v), 900)
        }}
        onBlur={() => saveNotes(notes)}
        rows={4}
        maxLength={20_000}
        placeholder="Where you left off, builds, codes, thoughts… only you can see these."
        className="w-full resize-y rounded-xl border border-border bg-surface-2 p-3 text-sm outline-none transition placeholder:text-muted hover:border-white/20 focus:border-accent"
      />
    </Section>
  )
}
