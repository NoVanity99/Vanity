import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloudOff } from 'lucide-react'
import { BannedCard } from './BannedCard'
import type { AccountState } from '@shared/types'
import { cn } from '@/lib/cn'
import { onboardingFor, startOnboarding, useOnboarding, type Onboarding as OnboardingState } from '@/state/onboarding'
import { AuthForm, ChooseUsername } from './AuthForm'
import { Onboarding } from './Onboarding'

type Gate = { kind: 'auth' } | { kind: 'username' } | { kind: 'banned'; reason: string } | { kind: 'onboarding'; state: OnboardingState } | null

/** What stands between this person and the launcher, if anything. */
export function gateFor(account: AccountState | null, onboarding: OnboardingState | null): Gate {
  // A build without an account service has nothing to sign in to.
  if (!account || !account.available) return null
  if (!account.signedIn) return { kind: 'auth' }
  if (account.standing.banned) return { kind: 'banned', reason: account.standing.reason }
  if (account.needsUsername) return { kind: 'username' }
  const state = onboardingFor(onboarding, account.email)
  return state ? { kind: 'onboarding', state } : null
}

export function useGate(account: AccountState | null): Gate {
  return gateFor(account, useOnboarding())
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

/**
 * The pop-up over a dimmed, blurred launcher whenever nobody is signed in (and while a new
 * account is being set up). There is no close button and no way round it: Log In or Sign Up.
 */
export function AuthGate({ account, gate }: { account: AccountState; gate: NonNullable<Gate> }): React.JSX.Element {
  const online = useOnline()
  const wide = gate.kind === 'onboarding'
  return createPortal(
    <div className="fixed inset-0 z-[48] flex animate-[fade-in_200ms_ease-out] items-center justify-center bg-black/55 p-4 backdrop-blur-md max-md:items-stretch max-md:p-3 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-md:pt-[calc(0.75rem+env(safe-area-inset-top))]" data-auth-gate={gate.kind}>
      {/* The window can still be moved by its top edge. */}
      <div className="absolute inset-x-0 top-0 h-9 [-webkit-app-region:drag]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={gate.kind === 'onboarding' ? 'Set up your account' : 'Log in to Vanity'}
        className={cn(
          'relative flex animate-[dialog-in_220ms_ease-out] flex-col overflow-hidden rounded-3xl border border-white/10 bg-surface/95 shadow-2xl shadow-black/60 ring-1 ring-accent/10',
          // A square on a computer; the whole screen's width on a phone, where a square would be too small.
          wide ? 'size-[min(94vw,calc(100dvh-3.5rem),46rem)] max-md:size-auto max-md:w-full' : 'size-[min(92vw,calc(100dvh-4.5rem),38rem)] max-md:size-auto max-md:w-full max-md:self-center'
        )}
      >
        <div className={cn('flex min-h-0 flex-1 flex-col p-7 max-md:p-5', !wide && 'overflow-y-auto [scrollbar-width:thin]')}>
          {gate.kind === 'onboarding' ? (
            <Onboarding account={account} state={gate.state} />
          ) : (
            <div className="my-auto">
              <div className="mb-5 text-center">
                <p className="font-display text-3xl font-black tracking-tight">
                  Van<span className="text-accent">ity</span>
                </p>
                <p className="mt-1 text-sm text-muted">{gate.kind === 'banned' ? 'You can no longer use this account.' : gate.kind === 'username' ? 'One more thing before you start.' : 'Log in or make an account to open your launcher.'}</p>
              </div>
              {!online && (
                <p className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-muted" data-gate-offline>
                  <CloudOff className="size-4 shrink-0" /> You're offline. Connect to the internet to log in.
                </p>
              )}
              {gate.kind === 'banned' ? (
                <BannedCard name={account.username ?? account.email ?? ''} reason={gate.reason} onSignOut={() => void window.vanity.account.signOut()} />
              ) : gate.kind === 'username' ? (
                <ChooseUsername email={account.email} />
              ) : (
                <AuthForm expired={account.sessionExpired} onSignedUp={startOnboarding} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
