import { nameFontFamily, PROFILE_AURAS, PROFILE_BANNERS, PROFILE_EFFECTS, PROFILE_FLAIRS, PROFILE_FRAMES, PROFILE_NAME_FONTS, PROFILE_NAME_STYLES, PROFILE_TITLES, type ProfileStyle } from '@shared/profileStyle'
import { Avatar } from '@/components/Avatar'
import { cn } from '@/lib/cn'

export interface LookPickerProps {
  /** The look as it stands (what is ticked). */
  style: ProfileStyle
  onPick: (patch: Partial<ProfileStyle>) => void
  /** Pointing at (or tabbing to) an option, to try it in a preview; null when leaving it. */
  onHover?: (patch: Partial<ProfileStyle> | null) => void
  name: string
  avatar: string | null
}

const chip = (active: boolean): string =>
  cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition', active ? 'border-accent bg-accent/15 text-text ring-2 ring-accent/30' : 'border-border text-muted hover:border-white/25 hover:text-text')
const tile = (active: boolean): string => cn('relative h-11 overflow-hidden rounded-lg border bg-surface transition hover:-translate-y-0.5', active ? 'border-accent ring-2 ring-accent/40' : 'border-border hover:border-white/25')

/** What every option button shares: it is a radio, picking saves, pointing previews. */
function option(p: LookPickerProps, key: keyof ProfileStyle, id: string): React.ButtonHTMLAttributes<HTMLButtonElement> & { 'data-look-option': string } {
  const patch = { [key]: id } as Partial<ProfileStyle>
  return {
    type: 'button',
    role: 'radio',
    'aria-checked': p.style[key] === id,
    onClick: () => p.onPick(patch),
    onMouseEnter: () => p.onHover?.(patch),
    onMouseLeave: () => p.onHover?.(null),
    onFocus: () => p.onHover?.(patch),
    onBlur: () => p.onHover?.(null),
    'data-look-option': id || 'none'
  }
}

/**
 * Every part of a profile's look, in the order they are offered. Account shows them all on one
 * page; signing up shows one per step. Both read this list, and each picker reads its options
 * from src/shared/profileStyle.ts, so a new banner, frame, font… (or a whole new section added
 * here) appears in both places by itself.
 */
export const LOOK_SECTIONS: { key: keyof ProfileStyle; title: string; hint: string; Picker: (p: LookPickerProps) => React.JSX.Element }[] = [
  {
    key: 'banner',
    title: 'Banner',
    hint: 'The backdrop behind your name on your profile.',
    Picker: (p) => (
      <div className="grid grid-cols-6 gap-2 max-md:grid-cols-4" role="radiogroup" aria-label="Banner">
        {PROFILE_BANNERS.map((b) => (
          <button key={b.id} {...option(p, 'banner', b.id)} title={b.label} className={tile(p.style.banner === b.id)}>
            <span className="profile-banner" data-banner={b.id} />
            <span className="absolute inset-x-0 bottom-0.5 truncate px-1 text-center text-[10px] font-semibold text-white/90 drop-shadow">{b.label}</span>
          </button>
        ))}
      </div>
    )
  },
  {
    key: 'effect',
    title: 'Banner effect',
    hint: 'Something moving over your banner.',
    Picker: (p) => (
      <div className="grid grid-cols-5 gap-2 max-md:grid-cols-3" role="radiogroup" aria-label="Banner effect">
        {PROFILE_EFFECTS.map((e) => (
          <button key={e.id} {...option(p, 'effect', e.id)} className={tile(p.style.effect === e.id)} data-pick-effect={e.id}>
            <span className="profile-banner" data-banner={p.style.banner} data-fx={e.id} />
            <span className="absolute inset-x-0 bottom-0.5 truncate px-1 text-center text-[10px] font-semibold text-white/90 drop-shadow">{e.label}</span>
          </button>
        ))}
      </div>
    )
  },
  {
    key: 'frame',
    title: 'Picture frame',
    hint: 'A ring around your picture.',
    Picker: (p) => (
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Picture frame">
        {PROFILE_FRAMES.map((f) => (
          <button key={f.id} {...option(p, 'frame', f.id)} className={cn(chip(p.style.frame === f.id), 'flex items-center gap-2')}>
            <span className="avatar-frame" data-frame={f.id} data-size="sm">
              <span className="block size-4 rounded-full bg-surface-2 ring-1 ring-bg" />
            </span>
            {f.label}
          </button>
        ))}
      </div>
    )
  },
  {
    key: 'aura',
    title: 'Picture aura',
    hint: 'A glow that moves around your picture.',
    Picker: (p) => (
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Picture aura">
        {PROFILE_AURAS.map((a) => (
          <button key={a.id} {...option(p, 'aura', a.id)} className={cn(chip(p.style.aura === a.id), 'flex items-center gap-2.5 py-2')} data-pick-aura={a.id}>
            <Avatar name={p.name || '?'} src={p.avatar} aura={a.id} size="sm" />
            {a.label}
          </button>
        ))}
      </div>
    )
  },
  {
    key: 'nameStyle',
    title: 'Name effect',
    hint: 'A colour or shine for your name.',
    Picker: (p) => (
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Name effect">
        {PROFILE_NAME_STYLES.map((n) => (
          <button key={n.id} {...option(p, 'nameStyle', n.id)} className={chip(p.style.nameStyle === n.id)}>
            <span className="name-fx text-sm font-bold" data-name={n.id}>
              {n.label}
            </span>
          </button>
        ))}
      </div>
    )
  },
  {
    key: 'nameFont',
    title: 'Name font',
    hint: 'The lettering your name is written in.',
    Picker: (p) => (
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Name font">
        {PROFILE_NAME_FONTS.map((f) => (
          <button key={f.id} {...option(p, 'nameFont', f.id)} className={chip(p.style.nameFont === f.id)} data-pick-font={f.id}>
            <span className={cn('text-sm', f.id === 'pixel' && 'text-[10px]')} style={f.family ? { fontFamily: nameFontFamily(f.id) } : undefined}>
              {f.label}
            </span>
          </button>
        ))}
      </div>
    )
  },
  {
    key: 'flair',
    title: 'Emoji next to your name',
    hint: 'A little symbol shown right after your name.',
    Picker: (p) => (
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Emoji next to your name">
        {PROFILE_FLAIRS.map((f) => (
          <button key={f || 'none'} {...option(p, 'flair', f)} aria-label={f || 'No emoji'} className={cn('flex size-9 items-center justify-center rounded-lg border text-lg transition hover:-translate-y-0.5', p.style.flair === f ? 'border-accent bg-accent/15 ring-2 ring-accent/30' : 'border-border hover:border-white/25')}>
            {f || <span className="text-[10px] font-semibold text-muted">None</span>}
          </button>
        ))}
      </div>
    )
  },
  {
    key: 'title',
    title: 'Title',
    hint: 'A short line under your name.',
    Picker: (p) => (
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Title">
        {PROFILE_TITLES.map((t) => (
          <button key={t || 'none'} {...option(p, 'title', t)} className={chip(p.style.title === t)} data-pick-title={t || 'none'}>
            {t || 'None'}
          </button>
        ))}
      </div>
    )
  }
]
