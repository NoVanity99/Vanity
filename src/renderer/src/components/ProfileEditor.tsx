import { useEffect, useRef, useState } from 'react'
import { Check, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { nameFontFamily, PROFILE_AURAS, PROFILE_BANNERS, PROFILE_EFFECTS, PROFILE_FLAIRS, PROFILE_FRAMES, PROFILE_NAME_FONTS, PROFILE_NAME_STYLES, PROFILE_TITLES, type ProfileStyle } from '@shared/profileStyle'
import type { AccountState } from '@shared/types'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Dialog'
import { ProfileTitle, UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { toAvatar } from '@/lib/avatarImage'
import { useToast } from '@/state/toasts'

const MAX_BIO = 200

/** Your profile picture and bio: what friends see next to your name. Saved to your account. */
export function ProfileEditor({ account }: { account: AccountState }): React.JSX.Element {
  const toast = useToast()
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'picture' | 'bio' | 'look' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bio, setBio] = useState(account.bio)
  // A bio changed on another device shows here, unless you're in the middle of typing one.
  const saved = useRef(account.bio)
  useEffect(() => {
    setBio((current) => (current === saved.current ? account.bio : current))
    saved.current = account.bio
  }, [account.bio])

  const save = async (kind: 'picture' | 'bio' | 'look', patch: { avatar?: string | null; bio?: string; style?: Partial<ProfileStyle> }, done: string | null): Promise<void> => {
    setBusy(kind)
    setError(null)
    const res = await window.vanity.account.setProfile(patch).catch((err: unknown) => ({ error: err instanceof Error ? err.message : 'Could not save that.', data: undefined }))
    setBusy(null)
    if (res.error !== undefined) setError(res.error)
    else if (done) toast(done)
  }

  // A look is saved the moment it is picked: the preview above shows it straight away.
  const [picked, setPicked] = useState<Partial<ProfileStyle>>({})
  const style: ProfileStyle = { ...account.style, ...picked }
  const pickLook = (patch: Partial<ProfileStyle>): void => {
    setPicked((p) => ({ ...p, ...patch }))
    void save('look', { style: patch }, null).finally(() => setPicked({}))
  }
  const chip = (active: boolean): string =>
    cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition', active ? 'border-accent bg-accent/15 text-text ring-2 ring-accent/30' : 'border-border text-muted hover:border-white/25 hover:text-text')

  const pick = async (picked: File | undefined): Promise<void> => {
    if (!picked) return
    setError(null)
    try {
      await save('picture', { avatar: await toAvatar(picked) }, 'Profile picture updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use that picture.')
    }
  }

  const length = [...bio.trim()].length
  const changed = bio.trim() !== account.bio

  return (
    <div className="relative mt-6 rounded-xl border border-border bg-surface-2/60 p-4" data-profile-editor>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">Your profile</p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Avatar name={account.username ?? '?'} src={account.avatar} size="lg" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            aria-label="Choose a profile picture"
            onChange={(e) => {
              void pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <Button onClick={() => file.current?.click()} disabled={busy !== null}>
            {busy === 'picture' ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} {account.avatar ? 'Change picture' : 'Add a picture'}
          </Button>
          {account.avatar && (
            <Button variant="ghost" className="hover:text-accent" onClick={() => save('picture', { avatar: null }, 'Profile picture removed')} disabled={busy !== null}>
              <Trash2 className="size-4" /> Remove
            </Button>
          )}
        </div>
      </div>

      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (changed && length <= MAX_BIO && !busy) void save('bio', { bio: bio.trim() }, bio.trim() ? 'Bio saved' : 'Bio removed')
        }}
      >
        <label htmlFor="profile-bio" className="text-xs font-semibold text-muted">
          Bio
        </label>
        <textarea
          id="profile-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={2}
          placeholder="Tell your friends a little about you."
          className="mt-1.5 w-full resize-none rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
        />
        <div className="mt-2 flex items-center gap-3">
          <span className={length > MAX_BIO ? 'text-xs font-semibold text-accent' : 'text-xs text-muted'}>
            {length}/{MAX_BIO}
          </span>
          <Button type="submit" variant="primary" className="ml-auto" disabled={!changed || length > MAX_BIO || busy !== null}>
            <Check className="size-4" /> {busy === 'bio' ? 'Saving…' : 'Save bio'}
          </Button>
        </div>
      </form>

      {/* The look: what you and everyone who sees your profile get. */}
      <div className="mt-5 border-t border-border pt-4" data-profile-look>
        <p className="text-xs font-semibold text-muted">Profile look</p>
        <p className="mt-0.5 text-xs text-muted">Banner and its effect, a frame and an aura for your picture, a color and font for your name, an emoji and a title. Your friends see them too.</p>

        <div className="relative mt-3 overflow-clip rounded-xl border border-border bg-surface p-4" data-look-preview>
          <div className="profile-banner" data-banner={style.banner} data-fx={style.effect ?? 'none'} />
          <div className="relative flex items-center gap-4">
            <Avatar name={account.username ?? '?'} src={account.avatar} frame={style.frame} aura={style.aura} size="lg" />
            <div className="min-w-0">
              <p className="font-display text-2xl font-bold">
                <UserName name={account.username ?? ''} style={style} verified={account.verified} admin={account.admin} badgeSize="md" />
              </p>
              <ProfileTitle title={style.title} className="my-1" />
              <p className="text-xs text-muted">This is how you look to your friends.</p>
            </div>
          </div>
        </div>

        <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-widest text-muted">Banner</p>
        <div className="grid grid-cols-6 gap-2 max-md:grid-cols-4" role="radiogroup" aria-label="Banner">
          {PROFILE_BANNERS.map((b) => (
            <button
              key={b.id}
              role="radio"
              aria-checked={style.banner === b.id}
              title={b.label}
              onClick={() => pickLook({ banner: b.id })}
              className={cn('relative h-11 overflow-hidden rounded-lg border bg-surface transition hover:-translate-y-0.5', style.banner === b.id ? 'border-accent ring-2 ring-accent/40' : 'border-border hover:border-white/25')}
            >
              <span className="profile-banner" data-banner={b.id} />
              <span className="absolute inset-x-0 bottom-0.5 truncate px-1 text-center text-[10px] font-semibold text-white/90 drop-shadow">{b.label}</span>
            </button>
          ))}
        </div>

        <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-widest text-muted">Banner effect</p>
        <div className="grid grid-cols-5 gap-2 max-md:grid-cols-3" role="radiogroup" aria-label="Banner effect">
          {PROFILE_EFFECTS.map((e) => (
            <button
              key={e.id}
              role="radio"
              aria-checked={style.effect === e.id}
              onClick={() => pickLook({ effect: e.id })}
              className={cn('relative h-11 overflow-hidden rounded-lg border bg-surface transition hover:-translate-y-0.5', style.effect === e.id ? 'border-accent ring-2 ring-accent/40' : 'border-border hover:border-white/25')}
              data-pick-effect={e.id}
            >
              <span className="profile-banner" data-banner={style.banner} data-fx={e.id} />
              <span className="absolute inset-x-0 bottom-0.5 truncate px-1 text-center text-[10px] font-semibold text-white/90 drop-shadow">{e.label}</span>
            </button>
          ))}
        </div>

        <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-widest text-muted">Picture frame</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Picture frame">
          {PROFILE_FRAMES.map((f) => (
            <button key={f.id} role="radio" aria-checked={style.frame === f.id} onClick={() => pickLook({ frame: f.id })} className={cn(chip(style.frame === f.id), 'flex items-center gap-2')}>
              <span className="avatar-frame" data-frame={f.id} data-size="sm">
                <span className="block size-4 rounded-full bg-surface-2 ring-1 ring-bg" />
              </span>
              {f.label}
            </button>
          ))}
        </div>

        <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-widest text-muted">Picture aura</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Picture aura">
          {PROFILE_AURAS.map((a) => (
            <button key={a.id} role="radio" aria-checked={style.aura === a.id} onClick={() => pickLook({ aura: a.id })} className={cn(chip(style.aura === a.id), 'flex items-center gap-2.5 py-2')} data-pick-aura={a.id}>
              <Avatar name={account.username ?? '?'} src={account.avatar} aura={a.id} size="sm" />
              {a.label}
            </button>
          ))}
        </div>

        <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-widest text-muted">Name effect</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Name effect">
          {PROFILE_NAME_STYLES.map((n) => (
            <button key={n.id} role="radio" aria-checked={style.nameStyle === n.id} onClick={() => pickLook({ nameStyle: n.id })} className={chip(style.nameStyle === n.id)}>
              <span className="name-fx text-sm font-bold" data-name={n.id}>
                {n.label}
              </span>
            </button>
          ))}
        </div>

        <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-widest text-muted">Name font</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Name font">
          {PROFILE_NAME_FONTS.map((f) => (
            <button key={f.id} role="radio" aria-checked={style.nameFont === f.id} onClick={() => pickLook({ nameFont: f.id })} className={chip(style.nameFont === f.id)} data-pick-font={f.id}>
              <span className={cn('text-sm', f.id === 'pixel' && 'text-[10px]')} style={f.family ? { fontFamily: nameFontFamily(f.id) } : undefined}>
                {f.label}
              </span>
            </button>
          ))}
        </div>

        <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-widest text-muted">Emoji next to your name</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Emoji next to your name">
          {PROFILE_FLAIRS.map((f) => (
            <button
              key={f || 'none'}
              role="radio"
              aria-checked={style.flair === f}
              aria-label={f || 'No emoji'}
              onClick={() => pickLook({ flair: f })}
              className={cn('flex size-9 items-center justify-center rounded-lg border text-lg transition hover:-translate-y-0.5', style.flair === f ? 'border-accent bg-accent/15 ring-2 ring-accent/30' : 'border-border hover:border-white/25')}
            >
              {f || <span className="text-[10px] font-semibold text-muted">None</span>}
            </button>
          ))}
        </div>

        <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-widest text-muted">Title</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Title">
          {PROFILE_TITLES.map((t) => (
            <button key={t || 'none'} role="radio" aria-checked={style.title === t} onClick={() => pickLook({ title: t })} className={chip(style.title === t)} data-pick-title={t || 'none'}>
              {t || 'None'}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="animate-pop-in mt-3 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
          {error}
        </p>
      )}
    </div>
  )
}
