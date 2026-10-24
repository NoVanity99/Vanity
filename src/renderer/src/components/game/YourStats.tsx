import { useMemo, useState } from 'react'
import { BarChart3, CalendarCheck, CalendarDays, CalendarRange, Clock3, Flame, Hourglass, Medal, PlayCircle, Sunrise } from 'lucide-react'
import type { Game, GamePlayStats } from '@shared/types'
import { formatHours, formatPlaytime, formatRelativeDate } from '@/lib/format'
import { byHour, byWeekday, favouriteTime, longestStreak, perDay, playedDays, playedWithin, streak } from '@/lib/playtime'
import { Figure, Section } from './parts'

const DAYS = 30
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Thin vertical bars with a hover tooltip. Single series, so no legend; a hidden table carries the numbers. */
function Bars({
  values,
  labels,
  tooltip,
  caption,
  height = 'h-36',
  showLabel
}: {
  values: number[]
  labels: string[]
  tooltip: (i: number) => string
  caption: string
  height?: string
  showLabel?: (i: number) => boolean
}): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...values)
  return (
    <div>
      <div className={`relative flex items-end gap-[2px] border-b border-border ${height}`} onMouseLeave={() => setHover(null)}>
        {values.map((v, i) => (
          <div key={i} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
            <div
              className="w-full rounded-t-[4px] bg-accent transition-[height,opacity] duration-700 ease-out"
              style={{ height: `${(v / max) * 100}%`, minHeight: v ? 3 : 0, opacity: hover === null || hover === i ? 1 : 0.45 }}
            />
            {hover === i && (
              <div className="animate-pop-in pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs shadow-xl">
                {tooltip(i)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px] text-[10px] text-muted" aria-hidden>
        {labels.map((l, i) => (
          // Labels may be wider than their bar: centre them under it and let them overflow.
          <span key={i} className="relative h-3 flex-1">
            {(!showLabel || showLabel(i)) && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{l}</span>}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {values.map((v, i) => (
            <tr key={i}>
              <th>{labels[i]}</th>
              <td>{formatPlaytime(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function YourStats({ game, stats, delay }: { game: Game; stats: GamePlayStats | null; delay?: number }): React.JSX.Element {
  const history = stats?.history ?? []
  const derived = useMemo(() => {
    const hours = byHour(history)
    return {
      days: perDay(history, DAYS),
      hours,
      weekdays: byWeekday(history),
      favourite: favouriteTime(hours),
      week: playedWithin(history, 7),
      month: playedWithin(history, 30),
      played: playedDays(history),
      best: longestStreak(history),
      current: streak(history)
    }
  }, [history])

  if (!stats) {
    return (
      <Section icon={BarChart3} title="Your stats" delay={delay}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="shimmer h-[92px] rounded-xl bg-white/[0.03]" />
          ))}
        </div>
      </Section>
    )
  }

  if (stats.sessions === 0 && game.playtimeSeconds === 0) {
    return (
      <Section icon={BarChart3} title="Your stats" delay={delay}>
        <p className="text-sm text-muted">Play it from Vanity and your sessions, streaks and play patterns show up here.</p>
      </Section>
    )
  }

  const pct = Math.round(stats.share * 100)
  return (
    <Section
      icon={BarChart3}
      title="Your stats"
      delay={delay}
      action={
        stats.rank !== null && (
          <span className="rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-text ring-1 ring-accent/30">
            #{stats.rank} most played of {stats.playedGames}
            {pct > 0 && ` · ${pct}% of your playtime`}
          </span>
        )
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure icon={PlayCircle} label="Sessions" value={String(stats.sessions)} sub={derived.favourite ? `Mostly ${derived.favourite.toLowerCase()}` : undefined} />
        <Figure icon={Clock3} label="Average session" value={stats.averageSeconds ? formatPlaytime(stats.averageSeconds) : '–'} />
        <Figure
          icon={Hourglass}
          label="Longest session"
          value={stats.longest ? formatPlaytime(stats.longest.seconds) : '–'}
          sub={stats.longest ? formatRelativeDate(stats.longest.startedAt) : undefined}
        />
        <Figure icon={Sunrise} label="First played" value={formatRelativeDate(stats.firstPlayedAt)} />
        <Figure icon={CalendarDays} label="Last 7 days" value={derived.week ? formatHours(derived.week) : '–'} />
        <Figure icon={CalendarRange} label="Last 30 days" value={derived.month ? formatHours(derived.month) : '–'} />
        <Figure icon={CalendarCheck} label="Days played" value={String(derived.played)} />
        <Figure
          icon={Flame}
          label="Best streak"
          value={`${derived.best} day${derived.best === 1 ? '' : 's'}`}
          sub={derived.current ? `${derived.current} day${derived.current === 1 ? '' : 's'} running now` : undefined}
        />
      </div>

      {history.length > 0 && (
        <div className="mt-8 grid gap-8 xl:grid-cols-[3fr_2fr]">
          <div>
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">Last {DAYS} days</h3>
            <Bars
              values={derived.days.map((d) => d.seconds)}
              labels={derived.days.map((d) => d.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}
              showLabel={(i) => i % 5 === 4}
              caption={`Playtime per day, last ${DAYS} days`}
              tooltip={(i) => {
                const d = derived.days[i]
                return `${d.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${d.seconds ? formatPlaytime(d.seconds) : 'No play'}`
              }}
            />
          </div>
          <div className="space-y-6">
            <div>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">Time of day</h3>
              <Bars
                height="h-14"
                values={derived.hours}
                labels={derived.hours.map((_, h) => `${String(h).padStart(2, '0')}:00`)}
                showLabel={(h) => h % 6 === 0}
                caption="Playtime by the hour sessions started"
                tooltip={(h) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00: ${formatPlaytime(derived.hours[h])}`}
              />
            </div>
            <div>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">Day of week</h3>
              <Bars
                height="h-14"
                values={derived.weekdays}
                labels={WEEKDAYS}
                caption="Playtime by weekday"
                tooltip={(i) => `${WEEKDAYS[i]}: ${formatPlaytime(derived.weekdays[i])}`}
              />
            </div>
          </div>
        </div>
      )}
      {history.length === 0 && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted">
          <Medal className="size-4" /> Playtime from before Vanity tracked sessions is counted, but has no history to chart.
        </p>
      )}
    </Section>
  )
}
