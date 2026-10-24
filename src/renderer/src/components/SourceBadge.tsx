import { SOURCE_LABELS, type GameSource } from '@shared/types'
import { cn } from '@/lib/cn'

const SHORT: Record<GameSource, string> = {
  steam: 'Steam',
  epic: 'Epic',
  gog: 'GOG',
  ea: 'EA',
  ubisoft: 'Ubisoft',
  custom: 'Local',
  manual: 'Local'
}

export function SourceBadge({ source, className }: { source: GameSource; className?: string }): React.JSX.Element {
  return (
    <span
      title={SOURCE_LABELS[source]}
      className={cn('rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80', className)}
    >
      {SHORT[source]}
    </span>
  )
}
