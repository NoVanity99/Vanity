import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, Clock, Flame, Gamepad2, Trophy } from 'lucide-react'
import type { PlayStats } from '@shared/ipc'
import { formatHours as hours, formatPlaytime, formatRelativeDate } from '@/lib/format'
import { perDay, streak } from '@/lib/playtime'
import { YearHeatmap } from '@/components/YearHeatmap'

const DAYS = 14

function Tile({ icon: Icon, label, value, sub, delay }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; delay: number }): React.JSX.Element {
  return (
    <div className="animate-rise-in rounded-2xl border border-border bg-surface p-5" style={{ '--delay': `${delay}ms` } as React.CSSProperties}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        <Icon className="size-4 text-accent" /> {label}
      </div>
      <p className="mt-3 font-display text-3xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-1 truncate text-xs text-muted">{sub}</p>}
    </div>
  )
}

export function StatsPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [stats, setStats] = useState<PlayStats | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    window.vanity.stats.get().then(setStats, () => {})
  }, [])

  const days = useMemo(() => (stats ? perDay(stats.recent, DAYS) : []), [stats])
  const maxDay = Math.max(1, ...days.map((d) => d.seconds))
  const maxGame = Math.max(1, ...(stats?.top ?? []).map((g) => g.seconds))
  const run = stats ? streak(stats.recent) : 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-8 px-10 pb-16 pt-12">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Your stats</h1>
          <p className="mt-1 text-sm text-muted">Everything you've played through Vanity.</p>
        </header>

        {!stats ? null : stats.totalSeconds === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-10 text-center text-muted">
            Play something from Vanity and your stats start here.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Tile icon={Clock} label="Total playtime" value={hours(stats.totalSeconds)} sub={`${stats.sessions} sessions`} delay={0} />
              <Tile icon={Gamepad2} label="Games played" value={String(stats.gamesPlayed)} delay={60} />
              <Tile
                icon={Trophy}
                label="Longest session"
                value={stats.longest ? formatPlaytime(stats.longest.seconds) : '–'}
                sub={stats.longest ? `${stats.longest.name}, ${formatRelativeDate(stats.longest.startedAt).toLowerCase()}` : undefined}
                delay={120}
              />
              <Tile icon={Flame} label="Streak" value={`${run} day${run === 1 ? '' : 's'}`} sub={run ? 'in a row with a session' : 'Play today to start one'} delay={180} />
            </div>

            <section className="animate-rise-in rounded-2xl border border-border bg-surface p-6" style={{ '--delay': '240ms' } as React.CSSProperties}>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <CalendarDays className="size-4 text-muted" /> Playtime, last {DAYS} days
              </h2>
              <div className="relative mt-6 flex h-44 items-end gap-[2px] border-b border-border" onMouseLeave={() => setHover(null)}>
                {days.map((d, i) => (
                  <div key={i} className="group relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
                    <div
                      className="w-full origin-bottom rounded-t-[4px] bg-accent transition-[height,opacity] duration-700 ease-out"
                      style={{ height: `${(d.seconds / maxDay) * 100}%`, minHeight: d.seconds ? 3 : 0, opacity: hover === null || hover === i ? 1 : 0.45 }}
                    />
                    {hover === i && (
                      <div className="animate-pop-in pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs shadow-xl">
                        <span className="text-muted">{d.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: </span>
                        <span className="font-semibold">{d.seconds ? formatPlaytime(d.seconds) : 'No play'}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-[2px] text-center text-[10px] text-muted" aria-hidden>
                {days.map((d, i) => (
                  <span key={i} className="flex-1">
                    {d.label}
                  </span>
                ))}
              </div>
              <table className="sr-only">
                <caption>Playtime per day</caption>
                <tbody>
                  {days.map((d, i) => (
                    <tr key={i}>
                      <th>{d.date.toDateString()}</th>
                      <td>{formatPlaytime(d.seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <YearHeatmap sessions={stats.recent} delay={270} />

            <section className="animate-rise-in rounded-2xl border border-border bg-surface p-6" style={{ '--delay': '300ms' } as React.CSSProperties}>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Trophy className="size-4 text-muted" /> Most played
              </h2>
              <ul className="mt-5 space-y-3">
                {stats.top.map((g, i) => (
                  <li key={g.id}>
                    <button onClick={() => navigate(`/game/${g.id}`)} className="group grid w-full grid-cols-[1.5rem_12rem_1fr_5rem] items-center gap-3 text-left">
                      <span className="text-sm tabular-nums text-muted">{i + 1}</span>
                      <span className="truncate text-sm font-medium transition-colors group-hover:text-accent">{g.name}</span>
                      <span className="h-3 overflow-hidden rounded-r-[4px] bg-white/5">
                        <span
                          className="block h-full rounded-r-[4px] bg-accent transition-[width] duration-700 ease-out"
                          style={{ width: `${(g.seconds / maxGame) * 100}%`, transitionDelay: `${i * 60}ms` }}
                        />
                      </span>
                      <span className="text-right text-sm tabular-nums text-muted">{hours(g.seconds)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
