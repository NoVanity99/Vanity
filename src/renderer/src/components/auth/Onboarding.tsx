import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react'
import { DEFAULT_PROFILE_STYLE, type ProfileStyle } from '@shared/profileStyle'
import type { AccountState } from '@shared/types'
import { Button } from '@/components/Dialog'
import { MAX_BIO } from '@/components/ProfileEditor'
import { LOOK_SECTIONS } from '@/components/profile/lookSections'
import { PicturePicker } from '@/components/profile/PicturePicker'
import { ProfileCard } from '@/components/profile/ProfileCard'
import { cn } from '@/lib/cn'
import { setOnboarding, type Onboarding as State } from '@/state/onboarding'
import { useToast } from '@/state/toasts'
import { useShop } from '@/state/shop'

/** Step 1 is the sign-up form, step 2 the picture and bio, then one step per part of the look. */
export const ONBOARDING_STEPS = 2 + LOOK_SECTIONS.length

export function StepProgress({ step, className }: { step: number; className?: string }): React.JSX.Element {
  return (
    <div className={className} data-step-progress={step}>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">
        Step {step} of {ONBOARDING_STEPS}
      </p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={1} aria-valuemax={ONBOARDING_STEPS} aria-valuenow={step} aria-label={`Step ${step} of ${ONBOARDING_STEPS}`}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(step / ONBOARDING_STEPS) * 100}%` }} />
      </div>
    </div>
  )
}

/**
 * Setting up a new account, one choice per page. Every page after the first can be skipped
 * (the default is used). Each Next saves that choice to the account, so nothing is lost if
 * Vanity is closed half-way; the last one opens the launcher.
 */
export function Onboarding({ account, state }: { account: AccountState; state: State }): React.JSX.Element {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<Partial<ProfileStyle> | null>(null)

  // Premium looks show their price here too; they are bought later, from Account.
  const shop = useShop()
  const locked = Object.fromEntries((shop?.items ?? []).filter((i) => !shop?.owned.includes(i.id)).map((i) => [i.id, i.price]))

  const step = Math.min(ONBOARDING_STEPS, Math.max(2, state.step))
  const section = step >= 3 ? LOOK_SECTIONS[step - 3] : null
  const last = step === ONBOARDING_STEPS
  const name = account.username ?? ''
  // What is saved on the account, plus what was picked here and not confirmed yet.
  const style: ProfileStyle = { ...account.style, ...state.style }
  const bio = state.bio
  const bioLength = [...bio.trim()].length

  const update = (patch: Partial<State>): void => setOnboarding({ ...state, ...patch })

  /** Saves this page's choice (if it differs from what the account has) and moves on. */
  const leave = async (skip: boolean): Promise<void> => {
    setError(null)
    let nextStyle = state.style
    const patch: { bio?: string; style?: Partial<ProfileStyle> } = {}
    if (section) {
      // Skipping means the default for this one.
      const value = skip ? DEFAULT_PROFILE_STYLE[section.key] : style[section.key]
      nextStyle = { ...state.style, [section.key]: value }
      if (account.style[section.key] !== value) patch.style = { [section.key]: value }
    } else if (!skip && bioLength <= MAX_BIO && bio.trim() !== account.bio) patch.bio = bio.trim()
    // The last step sends everything once more, in case an earlier save was missed.
    if (last) patch.style = { ...style, ...nextStyle }

    if (patch.bio !== undefined || patch.style) {
      setBusy(true)
      const res = await window.vanity.account.setProfile(patch).catch(() => ({ error: "Couldn't save that. Check your connection and try again.", data: undefined }))
      setBusy(false)
      if (res.error !== undefined) return setError(res.error)
    }
    setHover(null)
    if (last) {
      setOnboarding(null)
      toast(`Welcome to Vanity, ${name}!`)
    } else update({ step: step + 1, style: nextStyle, ...(skip && !section ? { bio: account.bio } : {}) })
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-onboarding={step}>
      <StepProgress step={step} className="shrink-0" />
      <h2 className="mt-4 shrink-0 text-xl font-semibold">{section ? section.title : 'Your picture and bio'}</h2>
      <p className="mt-0.5 shrink-0 text-sm text-muted">{section ? section.hint : 'Upload a picture or pick one, and say a little about yourself. You can change everything later in Account.'}</p>

      {/* From the banner step onwards, the real profile card stays in view while you choose. */}
      {section && (
        <div className="mt-4 shrink-0" data-onboarding-preview>
          <ProfileCard name={name} avatar={account.avatar} bio={account.bio} style={{ ...style, ...hover }} verified={account.verified} admin={account.admin} status="online">
            <p className="mt-0.5 text-xs text-muted">This is how you look to your friends.</p>
          </ProfileCard>
        </div>
      )}

      <div className="-mx-1 mt-4 min-h-0 flex-1 overflow-y-auto px-1 pb-1 [scrollbar-width:thin]">
        {section ? (
          <section.Picker style={style} onPick={(patch) => update({ style: { ...state.style, ...patch } })} onHover={setHover} name={name || '?'} avatar={account.avatar} locked={locked} onLocked={() => setError('That one is a premium look. You can get it later with Vanity Coins, from Account.')} />
        ) : (
          <>
            <PicturePicker
              name={name || '?'}
              avatar={account.avatar}
              disabled={busy}
              onSave={async (avatar) => {
                const res = await window.vanity.account.setProfile({ avatar })
                if (res.error !== undefined) throw new Error(res.error)
              }}
            />
            <label htmlFor="onboarding-bio" className="mt-5 block text-xs font-semibold text-muted">
              Bio
            </label>
            <textarea
              id="onboarding-bio"
              value={bio}
              onChange={(e) => update({ bio: e.target.value })}
              rows={3}
              placeholder="Tell your friends a little about you."
              className="mt-1.5 w-full resize-none rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
            <p className={cn('mt-1 text-xs', bioLength > MAX_BIO ? 'font-semibold text-accent' : 'text-muted')} data-bio-count>
              {bioLength}/{MAX_BIO}
            </p>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="animate-pop-in mt-3 shrink-0 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
          {error}
        </p>
      )}

      <div className="mt-4 flex shrink-0 items-center gap-2 border-t border-border pt-4">
        {/* Step 1 made the account, so there is nothing to go back to from step 2. */}
        {step > 2 && (
          <Button onClick={() => (setError(null), setHover(null), update({ step: step - 1 }))} disabled={busy} data-onboarding-back>
            <ArrowLeft className="size-4" /> Back
          </Button>
        )}
        <Button variant="ghost" className="ml-auto" onClick={() => void leave(true)} disabled={busy} data-onboarding-skip>
          Skip
        </Button>
        <Button variant="primary" onClick={() => void leave(false)} disabled={busy || (!section && bioLength > MAX_BIO)} data-onboarding-next>
          {busy ? <Loader2 className="size-4 animate-spin" /> : last ? <Check className="size-4" /> : null}
          {last ? 'Finish' : 'Next'}
          {!last && !busy && <ArrowRight className="size-4" />}
        </Button>
      </div>
    </div>
  )
}
