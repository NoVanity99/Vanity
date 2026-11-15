import { sanitizeProfile, type ProfileStyle } from '@shared/profile'
import { Avatar } from './Avatar'
import { UserBadges } from './UserBadges'
import { cn } from '@/lib/cn'

type Status = 'playing' | 'online' | 'offline' | undefined

/** A name drawn in its owner's chosen style, with their flair emoji. */
export function ProfileName({ name, style, className }: { name: string; style?: ProfileStyle | null; className?: string }): React.JSX.Element {
  const p = sanitizeProfile(style)
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <span className="profile-name truncate" data-name={p.nameStyle}>
        {name}
      </span>
      {p.flair && <span className="shrink-0">{p.flair}</span>}
    </span>
  )
}

/** The banner strip of a profile, with its moving effect. */
export function ProfileBanner({ style, className }: { style?: ProfileStyle | null; className?: string }): React.JSX.Element {
  const p = sanitizeProfile(style)
  return (
    <div className={cn('profile-banner h-24', className)} data-banner={p.banner}>
      <div className="profile-effect" data-effect={p.effect} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
    </div>
  )
}

/**
 * Someone's profile as a card: banner and effect, framed picture, styled name with official
 * badges, and tagline. Used for your own preview and for friends.
 */
export function ProfileCard({
  name,
  avatar,
  style,
  status,
  verified,
  admin,
  children,
  className
}: {
  name: string
  avatar?: string | null
  style?: ProfileStyle | null
  status?: Status
  verified?: boolean
  admin?: boolean
  /** Extra lines under the tagline (e.g. what they're playing). */
  children?: React.ReactNode
  className?: string
}): React.JSX.Element {
  const p = sanitizeProfile(style)
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-border bg-surface', className)}>
      <ProfileBanner style={p} />
      <div className="relative px-5 pb-5">
        <div className="-mt-9 flex items-end gap-4">
          <Avatar name={name} src={avatar} size="xl" status={status} frame={p.frame} />
          <div className="min-w-0 flex-1 pb-1">
            <span className="flex min-w-0 items-center gap-2">
              <ProfileName name={name} style={p} className="font-display text-2xl font-bold" />
              <UserBadges verified={verified} admin={admin} size="md" />
            </span>
            {p.tagline && <p className="truncate text-sm text-muted">{p.tagline}</p>}
          </div>
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  )
}
