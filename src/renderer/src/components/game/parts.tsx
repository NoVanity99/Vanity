import { cn } from '@/lib/cn'

type Icon = React.ComponentType<{ className?: string }>

/** A titled card on the game page. */
export function Section({
  icon: Icon,
  title,
  action,
  className,
  children,
  delay = 0
}: {
  icon?: Icon
  title: string
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
  delay?: number
}): React.JSX.Element {
  return (
    <section
      className={cn('animate-rise-in rounded-2xl border border-border bg-surface p-6', className)}
      style={{ '--delay': `${delay}ms` } as React.CSSProperties}
    >
      <div className="mb-5 flex items-center gap-3">
        <h2 className="flex flex-1 items-center gap-2 text-base font-semibold">
          {Icon && <Icon className="size-4 text-muted" />}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Chip({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <span className={cn('rounded-full bg-white/5 px-2.5 py-1 text-xs text-text/80 ring-1 ring-white/10', className)}>{children}</span>
}

/** Score colour: green for great, amber for mixed, red for poor. Always shown with the number, never alone. */
export function scoreColor(score: number): string {
  return score >= 75 ? '#34d399' : score >= 50 ? '#fbbf24' : '#f87171'
}

/** A 0–100 score as a ring gauge with the number in the middle. */
export function Ring({ score, label, sub, size = 72 }: { score: number; label: string; sub?: string; size?: number }): React.JSX.Element {
  const r = size / 2 - 5
  const c = 2 * Math.PI * r
  const color = scoreColor(score)
  return (
    <div className="flex flex-col items-center gap-2 text-center" title={sub ? `${label}: ${score} (${sub})` : `${label}: ${score}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={5} className="text-white/8" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - score / 100)}
            className="transition-[stroke-dashoffset] duration-1000 ease-out"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-display text-lg font-bold tabular-nums">{score}</span>
      </div>
      <div>
        <p className="text-xs font-semibold">{label}</p>
        {sub && <p className="text-[11px] text-muted">{sub}</p>}
      </div>
    </div>
  )
}

/** Small labelled number, used in the stat grids. */
export function Figure({ icon: Icon, label, value, sub }: { icon: Icon; label: string; value: string; sub?: string }): React.JSX.Element {
  return (
    <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <Icon className="size-3.5 text-accent" /> {label}
      </p>
      <p className="mt-2 font-display text-xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted">{sub}</p>}
    </div>
  )
}
