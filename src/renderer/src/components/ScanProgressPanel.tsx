import { SOURCE_LABELS, type ScanProgress } from '@shared/types'
import { cn } from '@/lib/cn'

const STATUS_TEXT: Record<ScanProgress['status'], string> = {
  pending: 'Waiting',
  scanning: 'Scanning…',
  done: 'Done',
  skipped: 'Skipped',
  error: 'Failed'
}

function StatusDot({ status }: { status: ScanProgress['status'] }): React.JSX.Element {
  if (status === 'scanning') {
    return <span className="size-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
  }
  return (
    <span
      className={cn(
        'size-2.5 rounded-full',
        status === 'done' && 'bg-emerald-400',
        status === 'error' && 'bg-accent',
        status === 'skipped' && 'bg-muted/60',
        status === 'pending' && 'bg-border'
      )}
    />
  )
}

export function ScanProgressPanel({ progress }: { progress: ScanProgress[] }): React.JSX.Element | null {
  if (progress.length === 0) return null
  const finished = progress.filter((p) => p.status !== 'pending' && p.status !== 'scanning').length
  const pct = Math.round((finished / progress.length) * 100)

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <ul className="space-y-2">
        {progress.map((p) => (
          <li key={p.source} className="flex items-center gap-3 text-sm">
            <span className="flex w-4 justify-center">
              <StatusDot status={p.status} />
            </span>
            <span className="w-36 font-medium">{SOURCE_LABELS[p.source]}</span>
            <span className={cn('w-24', p.status === 'error' ? 'text-accent' : 'text-muted')}>{STATUS_TEXT[p.status]}</span>
            {p.status === 'done' && <span className="w-20 tabular-nums">{p.found} found</span>}
            {p.message && <span className="truncate text-muted">{p.message}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
