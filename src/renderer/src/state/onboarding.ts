import { useSyncExternalStore } from 'react'
import { normalizeProfileStyle, type ProfileStyle } from '@shared/profileStyle'

/**
 * Where a brand-new account is in its set-up steps, kept on this device so closing Vanity
 * half-way loses nothing. Each finished step is already saved to the account itself; this only
 * remembers the step you were on and what you had picked there but not yet confirmed.
 */
export interface Onboarding {
  /** The account it belongs to (its email, lower case). */
  user: string
  /** The step being shown: 2 is the picture and bio, 3 onwards the look. */
  step: number
  /** The bio as typed so far. */
  bio: string
  /** Looks picked so far, including the unconfirmed one on the current step. */
  style: Partial<ProfileStyle>
}

const KEY = 'vanity.onboarding'
const listeners = new Set<() => void>()
let cache: Onboarding | null | undefined

function read(): Onboarding | null {
  if (cache !== undefined) return cache
  cache = null
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Onboarding> | null
    if (raw && typeof raw.user === 'string' && raw.user && typeof raw.step === 'number' && Number.isFinite(raw.step)) {
      // Only looks that exist are kept (the lists may have changed since it was written).
      const known = normalizeProfileStyle(raw.style)
      const style = Object.fromEntries(Object.keys(raw.style && typeof raw.style === 'object' ? raw.style : {}).filter((k) => k in known).map((k) => [k, known[k as keyof ProfileStyle]])) as Partial<ProfileStyle>
      cache = { user: raw.user, step: Math.max(2, Math.trunc(raw.step)), bio: typeof raw.bio === 'string' ? raw.bio.slice(0, 400) : '', style }
    }
  } catch {
    // Unreadable: treated as "not setting up".
  }
  return cache
}

/** Saves (or, with null, ends) the set-up. */
export function setOnboarding(next: Onboarding | null): void {
  cache = next
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // No storage: the steps still work until Vanity closes.
  }
  listeners.forEach((l) => l())
}

/** Starts the set-up steps for an account that was just created. */
export const startOnboarding = (email: string): void => setOnboarding({ user: email.trim().toLowerCase(), step: 2, bio: '', style: {} })

export function useOnboarding(): Onboarding | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    read
  )
}

/** Whether these set-up steps belong to the signed-in account. */
export const onboardingFor = (ob: Onboarding | null, email: string | null | undefined): Onboarding | null => (ob && !!email && ob.user === email.trim().toLowerCase() ? ob : null)
