import { CalendarDays, Flame } from 'lucide-react'
import type { UpcomingGame } from '@shared/types'
import { cn } from '@/lib/cn'
import { formatCompact } from '@/lib/format'
import { nameHue } from '@/lib/media'
import { FollowButton, releaseLabel } from './MostHypedBanner'

/** Upcoming hyped games by release month, soonest first. */
export function ReleaseCalendar({
  games,
  followed,
  onSelect,
  onFollow,
  onlyFollowed
}: {
  games: UpcomingGame[]
  followed: number[]
  onSelect: (g: UpcomingGame) => void
  onFollow: (g: UpcomingGame, on: boolean) => void
  onlyFollowed: boolean
}): React.JSX.Element | null {
  const following = new Set(followed)
  const list = games.filter((g) => !onlyFollowed || following.has(g.id)).sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.hypeRank - b.hypeRank)
  const months = new Map<string, UpcomingGame[]>()
  for (const g of list) {
    const key = g.releaseDate.slice(0, 7)
    months.set(key, [...(months.get(key) ?? []), g])
  }
  if (list.length === 0) {
    return onlyFollowed ? <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">Follow a game in the banner above and it shows up here, with a reminder on release day.</p> : null
  }
  return (
    <div className="space-y-6">
      {[...months.entries()].map(([month, items]) => (
        <section key={month}>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
            <CalendarDays className="size-3.5" />
            {new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h3>
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {items.map((g) => {
              const hue = nameHue(g.title)
              const day = new Date(`${g.releaseDate}T00:00:00`)
              return (
                <li key={g.id} className={cn('group relative flex items-center gap-3 rounded-2xl border bg-surface p-2.5 pr-3 transition hover:border-white/20', following.has(g.id) ? 'border-accent/40' : 'border-border')}>
                  <button onClick={() => onSelect(g)} className="flex min-w-0 flex-1 items-center gap-3 text-left" title={`Open ${g.title} in a store`}>
                    <span className="flex w-11 shrink-0 flex-col items-center rounded-xl bg-white/5 py-1.5 ring-1 ring-white/10">
                      <span className="text-[10px] font-semibold uppercase text-accent">{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                      <span className="font-display text-lg font-bold leading-none">{day.getDate()}</span>
                    </span>
                    <span className="h-14 w-10 shrink-0 overflow-hidden rounded-md" style={{ background: `hsl(${hue} 40% 20%)` }}>
                      {g.coverUrl && <img src={g.coverUrl} alt="" loading="lazy" className="size-full object-cover" draggable={false} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold transition-colors group-hover:text-accent">{g.title}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <Flame className="size-3 text-orange-400" />#{g.hypeRank} · {formatCompact(g.hype)} following · {releaseLabel(g.releaseDate)}
                      </span>
                    </span>
                  </button>
                  <FollowButton game={g} following={following.has(g.id)} onFollow={onFollow} className={following.has(g.id) ? '' : 'bg-white/5 text-muted ring-1 ring-white/10 backdrop-blur-none hover:bg-white/10 hover:text-text'} />
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
