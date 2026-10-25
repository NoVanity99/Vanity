import { useMemo, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatHours, formatPlaytime } from '@/lib/format'
import { dayKey, longestStreak, type SessionLike } from '@/lib/playtime'

const WEEKS = 53
const DAY = 86_400_000
/** Opacity steps of the accent colour, light to dark (one hue, more = darker). */
const LEVELS = ['bg-white/[0.05]', 'bg-accent/30', 'bg-accent/50', 'bg-accent/75', 'bg-accent']

interface Cell {
  date: Date
  seconds: number
  level: number
  future: boolean
}

/** Last year of play as a calendar: one square per day, darker for more playtime. */
export function buildHeatmap(sessions: SessionLike[], now = Date.now()): { weeks: Cell[][]; months: { label: string; col: number }[] } {
  const totals = new Map<string, number>()
  for (const s of sessions) totals.set(dayKey(s.startedAt), (totals.get(dayKey(s.startedAt)) ?? 0) + s.seconds)
  // Level thresholds from the spread of your own play days (quartiles), so the colours suit how much you play.
  const played = [...totals.values()].filter((v) => v > 0).sort((a, b) => a - b)
  const q = (p: number): number => played[Math.floor(p * (played.length - 1))] ?? 0
  const cuts = [q(0.25), q(0.5), q(0.75)]
  const level = (v: number): number => (v <= 0 ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4)

  const today = new Date(now)
  today.setHours(12, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - (WEEKS - 1) * 7) // a Monday, 52 weeks back
  const weeks: Cell[][] = []
  const months: { label: string; col: number }[] = []
  for (let w = 0; w < WEEKS; w++) {
    const week: Cell[] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(start)
      date.setDate(start.getDate() + w * 7 + d)
      const seconds = totals.get(dayKey(date.getTime())) ?? 0
      week.push({ date, seconds, level: level(seconds), future: date.getTime() > today.getTime() + DAY / 2 })
      if (date.getDate() === 1) months.push({ label: date.toLocaleDateString(undefined, { month: 'short' }), col: w })
    }
    weeks.push(week)
  }
  return { weeks, months }
}

export function YearHeatmap({ sessions, delay = 0 }: { sessions: SessionLike[]; delay?: number }): React.JSX.Element {
  const { weeks, months } = useMemo(() => buildHeatmap(sessions), [sessions])
  const [hover, setHover] = useState<Cell | null>(null)
  const cells = weeks.flat().filter((c) => !c.future)
  const total = cells.reduce((n, c) => n + c.seconds, 0)
  const active = cells.filter((c) => c.seconds > 0).length
  const best = cells.reduce<Cell | null>((b, c) => (c.seconds > (b?.seconds ?? 0) ? c : b), null)
  const streak = longestStreak(sessions)
  const fmt = (d: Date): string => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

  const byMonth = new Map<string, number>()
  for (const c of cells) {
    const k = c.date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    byMonth.set(k, (byMonth.get(k) ?? 0) + c.seconds)
  }

  return (
    <section className="animate-rise-in rounded-2xl border border-border bg-surface p-6" style={{ '--delay': `${delay}ms` } as React.CSSProperties}>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CalendarDays className="size-4 text-muted" /> Your year
        </h2>
        <span className="text-sm text-muted">
          <b className="font-semibold text-text">{formatHours(total)}</b> over <b className="font-semibold text-text">{active}</b> days
          {best && (
            <>
              {' '}
              · best day <b className="font-semibold text-text">{formatPlaytime(best.seconds)}</b>
            </>
          )}
          {streak > 1 && (
            <>
              {' '}
              · longest streak <b className="font-semibold text-text">{streak} days</b>
            </>
          )}
        </span>
      </div>

      <div className="relative mt-5 overflow-x-auto pb-1" onMouseLeave={() => setHover(null)}>
        <div className="inline-grid grid-flow-col gap-[3px]" style={{ gridTemplateRows: 'auto repeat(7, 11px)', gridTemplateColumns: `1.6rem repeat(${WEEKS}, 11px)` }}>
          {/* Month labels along the top, weekday labels down the side. */}
          <span />
          {weeks.map((_, w) => (
            <span key={`m${w}`} className="relative h-4 text-[10px] text-muted">
              {months.find((m) => m.col === w) && <span className="absolute left-0 whitespace-nowrap">{months.find((m) => m.col === w)!.label}</span>}
            </span>
          ))}
          {['Mon', '', 'Wed', '', 'Fri', '', ''].map((d, i) => (
            <span key={`d${i}`} className="text-[9px] leading-[11px] text-muted" style={{ gridColumn: 1, gridRow: i + 2 }}>
              {d}
            </span>
          ))}
          {weeks.map((week, w) =>
            week.map((c, d) => (
              <span
                key={`${w}-${d}`}
                style={{ gridColumn: w + 2, gridRow: d + 2 }}
                onMouseEnter={() => !c.future && setHover(c)}
                className={cn('size-[11px] rounded-[3px] transition-transform', c.future ? 'opacity-0' : LEVELS[c.level], hover === c && 'scale-125 ring-1 ring-white/60')}
              />
            ))
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span className="min-h-4">{hover ? `${fmt(hover.date)}: ${hover.seconds ? formatPlaytime(hover.seconds) : 'No play'}` : 'Hover a day to see your playtime.'}</span>
        <span className="flex items-center gap-1" aria-hidden>
          Less
          {LEVELS.map((l) => (
            <span key={l} className={cn('size-[11px] rounded-[3px]', l)} />
          ))}
          More
        </span>
      </div>

      <table className="sr-only">
        <caption>Playtime per month, last year</caption>
        <tbody>
          {[...byMonth].map(([m, s]) => (
            <tr key={m}>
              <th>{m}</th>
              <td>{formatPlaytime(s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
