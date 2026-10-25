import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { levelFor, totalXp } from '@/lib/xp'
import { useLibrary } from '@/state/library'

/** Your gamer level under the logo: level, title and progress to the next one. Glows on level-up. */
export function LevelBadge(): React.JSX.Element {
  const { games, loading } = useLibrary()
  const xp = useMemo(() => totalXp(games), [games])
  const lvl = levelFor(xp)
  const previous = useRef<number | null>(null)
  const [levelledUp, setLevelledUp] = useState(false)
  useEffect(() => {
    // The library starts empty (level 1) until it loads: only compare real levels.
    if (loading) return
    const prev = previous.current
    previous.current = lvl.level
    if (prev === null || lvl.level <= prev) return
    setLevelledUp(true)
    const t = setTimeout(() => setLevelledUp(false), 2500)
    return () => clearTimeout(t)
  }, [lvl.level, loading])

  const pct = Math.round((lvl.into / lvl.span) * 100)
  return (
    <NavLink
      to="/stats"
      title={`Level ${lvl.level} ${lvl.title}: ${lvl.into.toLocaleString()} / ${lvl.span.toLocaleString()} XP to the next level (${xp.toLocaleString()} XP in all)`}
      className={cn('mx-3 mb-2 flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-white/5', levelledUp && 'animate-pop-in bg-accent/15')}
    >
      <span className="relative flex size-9 shrink-0 items-center justify-center">
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" className="text-white/10" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 97.4} 97.4`} className="transition-[stroke-dasharray] duration-1000" />
        </svg>
        <span className="font-display text-xs font-bold tabular-nums">{lvl.level}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{levelledUp ? 'Level up!' : lvl.title}</span>
        <span className="block text-[10px] tabular-nums text-muted">
          {lvl.into.toLocaleString()} / {lvl.span.toLocaleString()} XP
        </span>
      </span>
    </NavLink>
  )
}
