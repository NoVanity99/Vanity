import { Check, Crown } from 'lucide-react'
import { cn } from '@/lib/cn'

const SIZES = {
  sm: { bubble: 'size-4', icon: 'size-2.5' },
  md: { bubble: 'size-5', icon: 'size-3' },
  lg: { bubble: 'size-7', icon: 'size-4' }
} as const

/**
 * The official badges next to a username: a blue check for verified accounts and a gold crown
 * for admins, side by side when an account has both. Only Vanity's server decides who has them
 * (server/src/roles.ts). Both have a light that sweeps across them.
 */
export function UserBadges({ verified, admin, size = 'sm', className }: { verified?: boolean; admin?: boolean; size?: keyof typeof SIZES; className?: string }): React.JSX.Element | null {
  if (!verified && !admin) return null
  const s = SIZES[size]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 align-middle', className)}>
      {verified && (
        <span
          role="img"
          aria-label="Verified"
          title="Verified: this is the official account"
          data-badge="verified"
          className={cn('badge-shine flex items-center justify-center rounded-full bg-gradient-to-br from-sky-300 via-sky-500 to-blue-600 text-white shadow-[0_0_8px_rgb(56_189_248/0.55)] ring-1 ring-white/40', s.bubble)}
        >
          <Check className={s.icon} strokeWidth={4} />
        </span>
      )}
      {admin && (
        <span
          role="img"
          aria-label="Admin"
          title="Admin: part of the Vanity team"
          data-badge="admin"
          className={cn('badge-shine badge-shine-late flex items-center justify-center rounded-full bg-gradient-to-br from-yellow-200 via-amber-400 to-amber-600 text-amber-950 shadow-[0_0_8px_rgb(251_191_36/0.6)] ring-1 ring-yellow-100/70', s.bubble)}
        >
          <Crown className={cn(s.icon, 'fill-amber-950/25')} strokeWidth={2.75} />
        </span>
      )}
    </span>
  )
}
