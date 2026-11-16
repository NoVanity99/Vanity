import { nameFontFamily, type ProfileStyle } from '@shared/profileStyle'
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
      <span
        className={cn('name-fx truncate', style?.nameFont === 'pixel' && 'text-[0.72em] leading-normal')}
        data-name={style?.nameStyle ?? 'plain'}
        data-font={style?.nameFont && style.nameFont !== 'app' ? style.nameFont : undefined}
        style={style?.nameFont && style.nameFont !== 'app' ? { fontFamily: nameFontFamily(style.nameFont) } : undefined}
      >
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

/** The title someone picked for under their name ("Night owl"), as a small pill. Nothing when they have none. */
export function ProfileTitle({ title, className }: { title?: string | null; className?: string }): React.JSX.Element | null {
  if (!title) return null
  return (
    <span data-profile-title className={cn('inline-flex w-fit items-center gap-1.5 rounded-full border border-white/15 bg-black/25 px-2.5 py-0.5 text-xs font-semibold text-text/90 backdrop-blur', className)}>
      <span aria-hidden className="text-accent">✦</span>
      {title}
    </span>
  )
}
