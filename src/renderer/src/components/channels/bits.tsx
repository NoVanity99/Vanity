import { useRef, useState } from 'react'
import { Globe, ImagePlus, Lock, EyeOff, Trash2, Users } from 'lucide-react'
import type { CommunityCard, Visibility } from '@shared/communities'
import { PROFILE_BANNERS } from '@shared/profileStyle'
import { Button } from '@/components/Dialog'
import { CropDialog } from '@/components/profile/PicturePicker'
import { cn } from '@/lib/cn'
import { cropAvatar, loadPicture } from '@/lib/avatarImage'
import { nameHue } from '@/lib/media'

// Small pieces the Channels screens share. ("Community" in code is what people see as a Channel.)

/** A community's picture: its icon, or its initials on a colour picked from its name. */
export function CommunityIcon({ name, icon, className }: { name: string; icon: string | null; className?: string }): React.JSX.Element {
  const hue = nameHue(name)
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase() || '?'
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden font-display font-bold text-white', className)} style={icon ? undefined : { background: `linear-gradient(135deg, hsl(${hue} 65% 50%), hsl(${(hue + 60) % 360} 70% 32%))` }}>
      {icon?.startsWith('data:image/') ? <img src={icon} alt="" className="size-full object-cover" draggable={false} /> : initials}
    </span>
  )
}

export const VISIBILITY_ICON: Record<Visibility, typeof Globe> = { open: Globe, private: Lock, hidden: EyeOff }

/** A community as a card: banner, icon, name, description, how many people and how many online. */
export function CommunityCardView({ c, action, onOpen }: { c: CommunityCard; action?: React.ReactNode; onOpen?: () => void }): React.JSX.Element {
  const Vis = VISIBILITY_ICON[c.visibility]
  return (
    <article className="community-card group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-lg shadow-black/20 transition duration-200 hover:-translate-y-1 hover:border-white/20 hover:shadow-2xl hover:shadow-black/40" data-community-card={c.name} data-visibility={c.visibility}>
      <button className="relative block h-24 w-full overflow-hidden text-left" onClick={onOpen} disabled={!onOpen} aria-label={`Open ${c.name}`}>
        <span className="profile-banner !inset-0 !h-full transition duration-500 group-hover:scale-105" data-banner={c.banner} />
        <span className="absolute inset-0 bg-gradient-to-t from-surface via-surface/20 to-transparent" />
        {c.visibility !== 'open' && (
          <span className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/90 backdrop-blur" title={c.visibility === 'private' ? 'Private: ask to join' : 'Hidden: invite only'} data-lock>
            <Vis className="size-3" /> {c.visibility === 'private' ? 'Private' : 'Hidden'}
          </span>
        )}
        {c.unread > 0 && <span className="absolute left-2.5 top-2.5 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white shadow-lg" data-card-unread>{c.unread > 99 ? '99+' : c.unread} new</span>}
      </button>
      <div className="relative flex flex-1 flex-col px-4 pb-4">
        <CommunityIcon name={c.name} icon={c.icon} className="-mt-7 size-14 rounded-2xl text-lg shadow-xl ring-4 ring-surface transition-all duration-200 group-hover:rounded-xl" />
        <h3 className="mt-2 truncate font-display text-base font-bold">{c.name}</h3>
        <p className="mt-0.5 line-clamp-2 min-h-8 text-xs leading-4 text-muted">{c.description || 'No description yet.'}</p>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1.5" data-online={c.online}>
            <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/70" /> {c.online.toLocaleString()} online
          </span>
          <span className="flex items-center gap-1.5" data-members={c.members}>
            <Users className="size-3" /> {c.members.toLocaleString()} {c.members === 1 ? 'member' : 'members'}
          </span>
        </div>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </article>
  )
}

/** A card-shaped placeholder while the real ones load. */
export function CardSkeleton(): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface" aria-hidden>
      <div className="skeleton h-24 w-full" />
      <div className="space-y-2 px-4 pb-4">
        <div className="skeleton -mt-7 size-14 rounded-2xl ring-4 ring-surface" />
        <div className="skeleton h-4 w-2/3 rounded" />
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-1/2 rounded" />
      </div>
    </div>
  )
}

/** Choosing a community's picture: upload, crop, see it. */
export function IconPicker({ name, icon, onChange }: { name: string; icon: string | null; onChange: (icon: string | null) => void }): React.JSX.Element {
  const file = useRef<HTMLInputElement>(null)
  const [cropping, setCropping] = useState<HTMLImageElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-4" data-icon-picker>
      <button type="button" onClick={() => file.current?.click()} className="group relative shrink-0" title="Upload a picture">
        <CommunityIcon name={name || '?'} icon={icon} className="size-20 rounded-full text-2xl ring-2 ring-border transition-all duration-200 group-hover:rounded-2xl group-hover:ring-accent" />
        <span className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-accent text-white shadow-lg">
          <ImagePlus className="size-3.5" />
        </span>
      </button>
      <div className="min-w-0">
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          aria-label="Choose a picture"
          onChange={(e) => {
            const picked = e.target.files?.[0]
            e.target.value = ''
            if (!picked) return
            setError(null)
            loadPicture(picked).then(setCropping, (err: unknown) => setError(err instanceof Error ? err.message : 'Could not use that picture.'))
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => file.current?.click()}>
            <ImagePlus className="size-4" /> {icon ? 'Change picture' : 'Upload a picture'}
          </Button>
          {icon && (
            <Button type="button" variant="ghost" onClick={() => onChange(null)}>
              <Trash2 className="size-4" /> Remove
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-muted">Optional. You'll be able to position it. Without one, its initials are shown.</p>
        {error && <p role="alert" className="mt-1 text-xs font-semibold text-accent">{error}</p>}
      </div>
      {cropping && (
        <CropDialog
          img={cropping}
          onClose={() => setCropping(null)}
          onDone={(crop) => {
            try {
              onChange(cropAvatar(cropping, crop))
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not use that picture.')
            }
            setCropping(null)
          }}
        />
      )}
    </div>
  )
}

/** Choosing a banner from Vanity's own (the same ones profiles use). */
export function BannerPicker({ value, onChange }: { value: string; onChange: (banner: string) => void }): React.JSX.Element {
  return (
    <div className="grid grid-cols-7 gap-1.5 max-md:grid-cols-4" role="radiogroup" aria-label="Banner" data-banner-picker>
      {PROFILE_BANNERS.map((b) => (
        <button key={b.id} type="button" role="radio" aria-checked={value === b.id} title={b.label} onClick={() => onChange(b.id)} className={cn('relative h-9 overflow-hidden rounded-lg border bg-surface transition hover:-translate-y-0.5', value === b.id ? 'border-accent ring-2 ring-accent/40' : 'border-border hover:border-white/25')} data-banner-option={b.id}>
          <span className="profile-banner !inset-0 !h-full" data-banner={b.id} />
        </button>
      ))}
    </div>
  )
}
