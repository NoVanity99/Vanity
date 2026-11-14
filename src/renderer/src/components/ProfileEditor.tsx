import { useEffect, useRef, useState } from 'react'
import { Check, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import type { AccountState } from '@shared/types'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Dialog'
import { toAvatar } from '@/lib/avatarImage'
import { useToast } from '@/state/toasts'

const MAX_BIO = 200

/** Your profile picture and bio: what friends see next to your name. Saved to your account. */
export function ProfileEditor({ account }: { account: AccountState }): React.JSX.Element {
  const toast = useToast()
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'picture' | 'bio' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bio, setBio] = useState(account.bio)
  // A bio changed on another device shows here, unless you're in the middle of typing one.
  const saved = useRef(account.bio)
  useEffect(() => {
    setBio((current) => (current === saved.current ? account.bio : current))
    saved.current = account.bio
  }, [account.bio])

  const save = async (kind: 'picture' | 'bio', patch: { avatar?: string | null; bio?: string }, done: string): Promise<void> => {
    setBusy(kind)
    setError(null)
    const res = await window.vanity.account.setProfile(patch).catch((err: unknown) => ({ error: err instanceof Error ? err.message : 'Could not save that.', data: undefined }))
    setBusy(null)
    if (res.error !== undefined) setError(res.error)
    else toast(done)
  }

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
      {error && (
        <p role="alert" className="animate-pop-in mt-3 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
          {error}
        </p>
      )}
    </div>
  )
}
