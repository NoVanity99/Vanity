import { useEffect, useState } from 'react'
import { ArrowLeft, AtSign, Check, Eye, EyeOff, KeyRound, LogOut, Mail, ShieldCheck, User, UserPlus } from 'lucide-react'
import { Button } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import { passwordStrength } from '@/lib/password'
import { useToast } from '@/state/toasts'
import { StepProgress } from './Onboarding'

const input =
  'h-11 w-full rounded-xl border border-border bg-surface-2 px-4 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function ErrorNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p role="alert" className="animate-pop-in rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
      {children}
    </p>
  )
}

type Mode = 'signin' | 'signup' | 'forgot' | 'reset'

type Free = boolean | null

/**
 * Asks the server, a moment after you stop typing, whether a username and an email are free.
 * true: free. false: already in use. null: not checked (too short, not an address yet, or offline).
 */
export function useAvailability(username: string, email: string, on: boolean): { username: Free; email: Free } {
  const [free, setFree] = useState<{ username: Free; email: Free }>({ username: null, email: null })
  useEffect(() => {
    setFree({ username: null, email: null })
    if (!on || (!username.trim() && !email.trim())) return
    let cancelled = false
    const timer = setTimeout(() => {
      window.vanity.account.availability({ username, email }).then(
        (r) => !cancelled && setFree(r),
        () => {}
      )
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [username, email, on])
  return free
}

/** The line under a field: "already in use" in red, or "available" in green. */
export function FreeNote({ free, what }: { free: Free; what: 'username' | 'email' }): React.JSX.Element | null {
  if (free === null) return null
  return free ? (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-400" data-free={what}>
      <Check className="size-3.5" /> {what === 'username' ? 'This username is available.' : 'This email can be used.'}
    </p>
  ) : (
    <p role="alert" className="mt-1.5 text-xs font-semibold text-accent" data-taken={what}>
      {what === 'username' ? 'That username is already in use.' : 'That email is already in use. Sign in instead, or use another email.'}
    </p>
  )
}

/** A password box with a button to show or hide what was typed. */
function PasswordInput({ value, onChange, placeholder, autoComplete, autoFocus, invalid, name }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string; autoFocus?: boolean; invalid?: boolean; name: string }): React.JSX.Element {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input className={cn(input, 'pr-11', invalid && 'border-accent')} type={shown ? 'text' : 'password'} placeholder={placeholder} aria-label={placeholder} autoComplete={autoComplete} autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} data-password={name} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        title={shown ? 'Hide password' : 'Show password'}
        className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition hover:bg-white/8 hover:text-text"
        data-password-toggle
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

/** Four bars and a word: how hard the password is to guess. */
function StrengthMeter({ password }: { password: string }): React.JSX.Element | null {
  if (!password) return null
  const s = passwordStrength(password)
  const color = ['bg-accent', 'bg-accent', 'bg-amber-400', 'bg-lime-400', 'bg-emerald-400'][s.score]
  return (
    <div className="mt-2" data-strength={s.score} aria-live="polite">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={cn('h-1 flex-1 rounded-full transition-colors', n <= s.score ? color : 'bg-white/10')} />
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">
        <span className={cn('font-semibold', s.score <= 1 ? 'text-accent' : s.score === 2 ? 'text-amber-300' : 'text-emerald-400')}>{s.label}.</span> {s.tip}
      </p>
    </div>
  )
}

/**
 * Sign in (with a username or an email), create an account, or reset a forgotten password with
 * a code sent by email. `onSignedUp` is told when a brand-new account was made here.
 */
export function AuthForm({ expired, onSignedUp }: { expired: boolean; onSignedUp?: (email: string) => void }): React.JSX.Element {
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('signin')
  // Sign in takes either; the other screens need the email itself.
  const [identifier, setIdentifier] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = (m: Mode): void => {
    // An email typed on the sign-in screen carries over; a username doesn't.
    if (m !== 'signin' && !email && identifier.includes('@')) setEmail(identifier.trim())
    setMode(m)
    setError(null)
    setPassword('')
    setConfirm('')
    setCode('')
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'signin') {
        const res = await window.vanity.account.signIn(identifier, password, remember)
        if (res.error !== undefined) return setError(res.error)
        toast(res.data.username ? `Welcome back, ${res.data.username}` : 'Signed in')
      } else if (mode === 'signup') {
        const res = await window.vanity.account.signUp(email, username, password, remember)
        if (res.error !== undefined) return setError(res.error)
        onSignedUp?.(res.data.email ?? email.trim())
      } else if (mode === 'forgot') {
        const res = await window.vanity.account.sendResetCode(email)
        if (res.error !== undefined) return setError(res.error)
        go('reset')
      } else {
        const res = await window.vanity.account.resetPassword(email, code, password)
        if (res.error !== undefined) return setError(res.error)
        // Vanity signs in with the new password and ends every other session.
        const state = await window.vanity.account.state().catch(() => null)
        toast(state?.signedIn ? 'Password changed. Other devices were signed out.' : 'Password changed. Sign in with the new one.')
        if (!state?.signedIn) {
          setIdentifier(email)
          go('signin')
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const free = useAvailability(username, email, mode === 'signup')
  const emailTyped = email.trim()
  const badEmail = mode === 'signup' && emailTyped.length > 3 && !EMAIL.test(emailTyped)
  const mismatch = mode === 'reset' && confirm.length > 0 && confirm !== password
  const ready =
    mode === 'signin'
      ? !!identifier.trim() && !!password
      : mode === 'signup'
        ? EMAIL.test(emailTyped) && !!username && password.length >= 8 && free.username !== false && free.email !== false
        : mode === 'forgot'
          ? EMAIL.test(emailTyped)
          : code.length >= 4 && password.length >= 8 && confirm === password

  return (
    <div data-auth-form={mode}>
      {expired && mode === 'signin' && (
        <p className="mb-5 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          <KeyRound className="size-4 shrink-0" /> Your session has expired. Sign in again to carry on.
        </p>
      )}

      {mode === 'signin' || mode === 'signup' ? (
        <div className="mb-6 grid grid-cols-2 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Log in or sign up">
          {(['signin', 'signup'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => go(m)} className={cn('rounded-lg py-2 text-sm font-semibold transition', mode === m ? 'bg-accent text-white shadow-lg shadow-accent/25' : 'text-muted hover:text-text')} data-auth-tab={m}>
              {m === 'signin' ? 'Log In' : 'Sign Up'}
            </button>
          ))}
        </div>
      ) : (
        <div className="mb-5">
          <button onClick={() => go('signin')} className="mb-3 flex items-center gap-1.5 text-sm text-muted transition hover:text-text">
            <ArrowLeft className="size-4" /> Back to log in
          </button>
          <h2 className="text-lg font-semibold">{mode === 'forgot' ? 'Forgot your password?' : 'Set a new password'}</h2>
          <p className="mt-1 text-sm text-muted" data-reset-note>
            {mode === 'forgot'
              ? "Enter your account's email and we'll send you a 6-digit code to set a new password."
              : `If an account uses ${emailTyped}, we've emailed it a 6-digit code. It can take a minute, and may land in spam. Enter it below with your new password.`}
          </p>
        </div>
      )}

      {/* Signing up is the first of the set-up steps. */}
      {mode === 'signup' && <StepProgress step={1} className="mb-4" />}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !busy) void submit()
        }}
      >
        {mode === 'signin' && (
          <div className="relative">
            <User className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input className={cn(input, 'pl-10')} placeholder="Username or email" aria-label="Username or email" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus spellCheck={false} maxLength={320} data-identifier />
          </div>
        )}
        {(mode === 'signup' || mode === 'forgot') && (
          <div>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input className={cn(input, 'pl-10', (badEmail || (mode === 'signup' && free.email === false)) && 'border-accent')} type="email" placeholder="Email" aria-label="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus spellCheck={false} />
            </div>
            {badEmail ? (
              <p role="alert" className="mt-1.5 text-xs font-semibold text-accent" data-bad-email>
                That doesn't look like an email address.
              </p>
            ) : (
              mode === 'signup' && <FreeNote free={free.email} what="email" />
            )}
          </div>
        )}
        {mode === 'signup' && (
          <div>
            <div className="relative">
              <AtSign className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input className={cn(input, 'pl-10', free.username === false && 'border-accent')} placeholder="Username" aria-label="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} maxLength={20} />
            </div>
            <FreeNote free={free.username} what="username" />
            {free.username === null && <p className="mt-1.5 text-xs text-muted">3–20 letters, numbers or underscores. Friends add you by it; your email stays private.</p>}
          </div>
        )}
        {mode === 'reset' && (
          <input
            className={cn(input, 'text-center font-mono text-lg tracking-[0.4em] placeholder:font-sans placeholder:text-sm placeholder:tracking-normal')}
            inputMode="numeric"
            placeholder="6-digit code"
            aria-label="6-digit code"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
            autoFocus
            maxLength={10}
            data-reset-code
          />
        )}
        {mode !== 'forgot' && (
          <div>
            <PasswordInput name="password" value={password} onChange={setPassword} placeholder={mode === 'signin' ? 'Password' : mode === 'reset' ? 'New password (at least 8 characters)' : 'Password (at least 8 characters)'} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
            {mode !== 'signin' && <StrengthMeter password={password} />}
          </div>
        )}
        {mode === 'reset' && (
          <div>
            <PasswordInput name="confirm" value={confirm} onChange={setConfirm} placeholder="Confirm new password" autoComplete="new-password" invalid={mismatch} />
            {mismatch && (
              <p role="alert" className="mt-1.5 text-xs font-semibold text-accent" data-mismatch>
                The two passwords don't match.
              </p>
            )}
          </div>
        )}

        {(mode === 'signin' || mode === 'signup') && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <label className="flex cursor-pointer select-none items-center gap-2 text-muted">
              <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Stay signed in
            </label>
            {mode === 'signin' && (
              <button type="button" onClick={() => go('forgot')} className="text-muted underline-offset-4 transition hover:text-text hover:underline" data-forgot>
                Forgot password?
              </button>
            )}
          </div>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        <Button type="submit" variant="primary" className="h-11 w-full text-base" disabled={busy || !ready}>
          {mode === 'signin' ? (
            busy ? 'Logging in…' : 'Log In'
          ) : mode === 'signup' ? (
            busy ? 'Creating…' : (
              <>
                <UserPlus className="size-4" /> Create account
              </>
            )
          ) : mode === 'forgot' ? (
            busy ? 'Sending…' : 'Email me a code'
          ) : busy ? (
            'Saving…'
          ) : (
            'Save new password'
          )}
        </Button>
        {mode === 'reset' && (
          <button type="button" disabled={busy} onClick={() => go('forgot')} className="w-full text-center text-sm text-muted transition hover:text-text">
            Didn't get it? Send a new code
          </button>
        )}
      </form>

      <p className="mt-5 flex items-start gap-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
        Your password is checked by Vanity's sign-in service and never stored on this device.
      </p>
    </div>
  )
}

/** A signed-in account without a username yet (sign-up was interrupted, or the name got taken). */
export function ChooseUsername({ email }: { email: string | null }): React.JSX.Element {
  const toast = useToast()
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const free = useAvailability(username, '', true)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await window.vanity.account.setUsername(username)
    setBusy(false)
    if (res.error !== undefined) setError(res.error)
    else toast(`Welcome to Vanity, ${res.data.username}!`)
  }

  return (
    <div data-choose-username>
      <h2 className="text-lg font-semibold">Choose your username</h2>
      <p className="mt-1 text-sm text-muted">You're signed in{email ? ` as ${email}` : ''}. Pick the name your friends will add you by.</p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (username && !busy && free.username !== false) void save()
        }}
      >
        <div className="relative">
          <AtSign className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input className={cn(input, 'pl-10', free.username === false && 'border-accent')} placeholder="Username" aria-label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus spellCheck={false} maxLength={20} />
        </div>
        <FreeNote free={free.username} what="username" />
        <p className="text-xs text-muted">3–20 letters, numbers or underscores.</p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex gap-3">
          <Button type="submit" variant="primary" className="h-11 flex-1" disabled={busy || !username || free.username === false}>
            <Check className="size-4" /> {busy ? 'Saving…' : 'Save username'}
          </Button>
          <Button type="button" className="h-11" onClick={() => void window.vanity.account.signOut()}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </form>
    </div>
  )
}
