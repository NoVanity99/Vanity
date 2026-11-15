import type { ProfileStyle } from '@shared/profileStyle'
import { cn } from '@/lib/cn'
import { UserBadges } from './UserBadges'

/**
 * A username the way its owner styled it: the name effect, their emoji, then the official badges.
 * `style` comes from the account (src/shared/profileStyle.ts); without one the name is plain.
 */
export function UserName({
  name,
  style,
  verified,
  admin,
  badgeSize = 'sm',
  className
}: {
  name: string
  style?: Partial<ProfileStyle> | null
  verified?: boolean
  admin?: boolean
  badgeSize?: 'sm' | 'md' | 'lg'
  className?: string
}): React.JSX.Element {
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-[0.35em]', className)} data-user-name>
      <span className="name-fx truncate" data-name={style?.nameStyle ?? 'plain'}>
        {name}
      </span>
      {style?.flair && (
        <span aria-hidden className="shrink-0 text-[0.8em] leading-none" data-flair>
          {style.flair}
        </span>
      )}
      <UserBadges verified={verified} admin={admin} size={badgeSize} />
    </span>
  )
}
