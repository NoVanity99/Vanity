import { Timer } from 'lucide-react'
import type { GameDetails } from '@shared/types'
import { formatHours } from '@/lib/format'
import { Section } from './parts'

/** IGDB's community completion times, with your own playtime marked against them. */
export function TimeToBeat({ ttb, playtime, delay }: { ttb: NonNullable<GameDetails['timeToBeat']>; playtime: number; delay?: number }): React.JSX.Element {
  const rows = [
    { label: 'Main story', seconds: ttb.main },
    { label: 'Main + extras', seconds: ttb.extra },
    { label: 'Completionist', seconds: ttb.completionist }
  ].filter((r): r is { label: string; seconds: number } => r.seconds !== null)
  const max = Math.max(playtime, ...rows.map((r) => r.seconds))
  const target = ttb.main ?? ttb.extra ?? ttb.completionist ?? 0
  const pct = target ? Math.min(100, Math.round((playtime / target) * 100)) : 0

  return (
    <Section
      icon={Timer}
      title="Time to beat"
      delay={delay}
      action={ttb.count > 0 && <span className="text-xs text-muted">From {ttb.count.toLocaleString()} players on IGDB</span>}
    >
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[8rem_1fr_4rem] items-center gap-4 text-sm">
            <span className="text-muted">{r.label}</span>
            <span className="relative h-2.5 rounded-r-[4px] bg-white/5">
              <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-white/25" style={{ width: `${(r.seconds / max) * 100}%` }} />
            </span>
            <span className="text-right font-semibold tabular-nums">{formatHours(r.seconds)}</span>
          </div>
        ))}
        <div className="grid grid-cols-[8rem_1fr_4rem] items-center gap-4 text-sm">
          <span className="font-semibold">You</span>
          <span className="relative h-2.5 rounded-r-[4px] bg-white/5">
            <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-accent transition-[width] duration-1000" style={{ width: `${(playtime / max) * 100}%` }} />
          </span>
          <span className="text-right font-semibold tabular-nums">{playtime ? formatHours(playtime) : '0 h'}</span>
        </div>
      </div>
      {target > 0 && (
        <p className="mt-4 text-sm text-muted">
          {playtime === 0
            ? `About ${formatHours(target)} to finish the main story.`
            : pct >= 100
              ? "You've played longer than the main story usually takes."
              : `You're about ${pct}% of the way through a typical main story run.`}
        </p>
      )}
    </Section>
  )
}
