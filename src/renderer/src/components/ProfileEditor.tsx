import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import type { ProfileStyle } from '@shared/profileStyle'
import type { AccountState } from '@shared/types'
import { Button } from '@/components/Dialog'
import { LOOK_SECTIONS } from '@/components/profile/lookSections'
import { PicturePicker } from '@/components/profile/PicturePicker'
import { ProfileCard } from '@/components/profile/ProfileCard'
import { useToast } from '@/state/toasts'

export const MAX_BIO = 200

/** Your profile picture, bio and look: what friends see next to your name. Saved to your account. */
export function ProfileEditor({ account }: { account: AccountState }): React.JSX.Element {
  const toast = useToast()
  const [busy, setBusy] = useState<'bio' | 'look' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bio, setBio] = useState(account.bio)
  // A bio changed on another device shows here, unless you're in the middle of typing one.
  const saved = useRef(account.bio)
  useEffect(() => {
    setBio((current) => (current === saved.current ? account.bio : current))
    saved.current = account.bio
  }, [account.bio])

  const save = async (kind: 'bio' | 'look', patch: { bio?: string; style?: Partial<ProfileStyle> }, done: string | null): Promise<void> => {
    setBusy(kind)
    setError(null)
    const res = await window.vanity.account.setProfile(patch).catch((err: unknown) => ({ error: err instanceof Error ? err.message : 'Could not save that.', data: undefined }))
    setBusy(null)
    if (res.error !== undefined) setError(res.error)
    else if (done) toast(done)
  }

  // A look is saved the moment it is picked: the preview above shows it straight away.
  const [picked, setPicked] = useState<Partial<ProfileStyle>>({})
  // Pointing at an option tries it in the preview without saving.
  const [hover, setHover] = useState<Partial<ProfileStyle> | null>(null)
  const style: ProfileStyle = { ...account.style, ...picked }
  const pickLook = (patch: Partial<ProfileStyle>): void => {
    setPicked((p) => ({ ...p, ...patch }))
    void save('look', { style: patch }, null).finally(() => setPicked({}))
  }

  const length = [...bio.trim()].length
  const changed = bio.trim() !== account.bio

  return (
    <div className="relative mt-6 rounded-xl border border-border bg-surface-2/60 p-4" data-profile-editor>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">Your profile</p>
      <div className="mt-3">
        <PicturePicker
          name={account.username ?? '?'}
          avatar={account.avatar}
          onSave={async (avatar) => {
            const res = await window.vanity.account.setProfile({ avatar })
            if (res.error !== undefined) throw new Error(res.error)
            toast(avatar ? 'Profile picture updated' : 'Profile picture removed')
          }}
        />
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

        <div className="sticky top-2 z-10 mt-3" data-look-preview>
          <ProfileCard name={account.username ?? ''} avatar={account.avatar} bio={account.bio} style={{ ...style, ...hover }} verified={account.verified} admin={account.admin} className="shadow-xl shadow-black/30">
            <p className="text-xs text-muted">This is how you look to your friends.</p>
          </ProfileCard>
        </div>

        {LOOK_SECTIONS.map(({ key, title, Picker }) => (
          <div key={key} data-look-section={key}>
            <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-widest text-muted">{title}</p>
            <Picker style={style} onPick={pickLook} onHover={setHover} name={account.username ?? '?'} avatar={account.avatar} />
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="animate-pop-in mt-3 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
          {error}
        </p>
      )}
    </div>
  )
}
