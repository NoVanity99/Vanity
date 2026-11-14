import { sanitizeProfile, type ProfileStyle } from '@shared/profile'
import { Avatar } from './Avatar'
import { cn } from '@/lib/cn'

type Status = 'playing' | 'online' | 'offline' | undefined

/** A name drawn in its owner's chosen style, with their flair emoji. */
export function ProfileName({ name, profile, className }: { name: string; profile?: ProfileStyle | null; className?: string }): React.JSX.Element {
  const p = sanitizeProfile(profile)
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <span className="profile-name truncate" data-name={p.nameStyle}>
        {name}
      </span>
      {p.flair && <span className="shrink-0">{p.flair}</span>}
    </span>
  )
}

/**
 * Someone's profile as a card: their banner with its moving effect, their framed picture, their
 * styled name and tagline. Used for your own preview and for friends.
 */
export function ProfileCard({
  name,
  profile,
  status,
  children,
  className
}: {
  name: string
  profile?: ProfileStyle | null
  status?: Status
  /** Extra lines under the tagline (e.g. what they're playing). */
  children?: React.ReactNode
  className?: string
}): React.JSX.Element {
  const p = sanitizeProfile(profile)
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-border bg-surface', className)}>
      <div className="profile-banner h-24" data-banner={p.banner}>
        <div className="profile-effect" data-effect={p.effect} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
      </div>
      <div className="relative px-5 pb-5">
        <div className="-mt-9 flex items-end gap-4">
          <Avatar name={name} size="xl" status={status} frame={p.frame} />
          <div className="min-w-0 flex-1 pb-1">
            <ProfileName name={name} profile={p} className="max-w-full font-display text-2xl font-bold" />
            {p.tagline && <p className="truncate text-sm text-muted">{p.tagline}</p>}
          </div>
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  )
}
