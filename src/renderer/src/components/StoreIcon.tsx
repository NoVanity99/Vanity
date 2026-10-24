import { STORE_LABELS, type StoreLauncher } from '@shared/types'
import { cn } from '@/lib/cn'

/**
 * Compact store badges: a short mark on each store's signature colour.
 * (Generic marks rather than the stores' trademarked logos; swap in official
 * SVGs here if you have them.)
 */
const STYLE: Record<StoreLauncher, { mark: string; bg: string; fg: string }> = {
  steam: { mark: 'S', bg: '#1b2838', fg: '#66c0f4' },
  epic: { mark: 'E', bg: '#2a2a2a', fg: '#ffffff' },
  ea: { mark: 'EA', bg: '#ff4747', fg: '#ffffff' },
  ubisoft: { mark: 'U', bg: '#0070ff', fg: '#ffffff' },
  battlenet: { mark: 'B', bg: '#0e86ca', fg: '#ffffff' },
  gog: { mark: 'G', bg: '#86328a', fg: '#ffffff' },
  microsoft: { mark: 'MS', bg: '#107c10', fg: '#ffffff' }
}

export function StoreIcon({ launcher, size = 'sm', className }: { launcher: StoreLauncher; size?: 'sm' | 'lg'; className?: string }): React.JSX.Element {
  const s = STYLE[launcher]
  return (
    <span
      title={STORE_LABELS[launcher]}
      aria-label={STORE_LABELS[launcher]}
      style={{ background: s.bg, color: s.fg }}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-black leading-none tracking-tight ring-1 ring-white/10',
        size === 'sm' ? 'size-5 rounded-[5px] text-[9px]' : 'size-10 rounded-xl text-sm',
        className
      )}
    >
      {s.mark}
    </span>
  )
}
