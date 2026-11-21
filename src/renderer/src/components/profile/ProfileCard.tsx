import type { ReactNode } from 'react'
import type { ProfileStyle } from '@shared/profileStyle'
import { Avatar } from '@/components/Avatar'
import { ProfileTitle, UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'

type Status = 'playing' | 'online' | 'offline'

/**
 * A player's profile card: banner and its effect, picture with frame and aura, the name the way
 * they styled it, their title and bio. This is what a friend's profile page shows at the top,
 * and what the previews in Account and in the sign-up steps show, so they can never drift apart.
 */
export function ProfileCard({
  name,
  avatar,
  bio,
  style,
  verified,
  admin,
  status,
  eyebrow,
  size = 'card',
  heading = 'p',
  className,
  aside,
  footer,
  children
}: {
  name: string
  avatar?: string | null
  bio?: string | null
  style?: Partial<ProfileStyle> | null
  verified?: boolean
  admin?: boolean
  status?: Status
  /** A small line above the name (a friend's level title). */
  eyebrow?: ReactNode
  /** `page`: the top of a profile page. `card`: a compact preview. */
  size?: 'page' | 'card'
  heading?: 'h1' | 'p'
  className?: string
  /** Beside the name block (what a friend is playing, their level). */
  aside?: ReactNode
  /** Under everything (a level bar). */
  footer?: ReactNode
  /** Shown under the bio (a status line, buttons, a caption). */
  children?: ReactNode
}): React.JSX.Element {
  const Heading = heading
  const page = size === 'page'
  return (
    <section className={cn('relative overflow-clip border border-border bg-surface', page ? 'rounded-3xl p-7 max-md:p-5' : 'rounded-xl p-4', className)} data-profile-card>
      <div className="profile-banner" data-banner={style?.banner ?? 'default'} data-fx={style?.effect ?? 'none'} />
      <div className={cn('relative flex items-center', page ? 'flex-wrap gap-6' : 'gap-4')}>
        <Avatar name={name || '?'} src={avatar} frame={style?.frame} aura={style?.aura} size={page ? 'xl' : 'lg'} status={status} />
        <div className="min-w-0 flex-1">
          {eyebrow}
          <Heading className={cn('font-display', page ? 'text-4xl font-black tracking-tight max-md:text-3xl' : 'text-2xl font-bold')}>
            <UserName name={name} style={style} verified={verified} admin={admin} badgeSize={page ? 'lg' : 'md'} />
          </Heading>
          <ProfileTitle title={style?.title} className={page ? 'mt-1.5' : 'my-1'} />
          {bio && <p className={cn('max-w-xl whitespace-pre-wrap break-words text-text/85', page ? 'mt-1.5 text-sm' : 'mt-1 line-clamp-3 text-xs')} data-card-bio>{bio}</p>}
          {children}
        </div>
        {aside}
      </div>
      {footer}
    </section>
  )
}
