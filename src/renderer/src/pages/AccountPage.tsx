import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, AtSign, Check, CloudOff, KeyRound, LogOut, Mail, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { Button, Dialog } from '@/components/Dialog'
import { LinkedAccounts } from '@/components/LinkedAccounts'
import { ProfileEditor } from '@/components/ProfileEditor'
import { ProfileTitle, UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { useAccount } from '@/state/account'
import { useToast } from '@/state/toasts'

const input =
  'h-11 w-full rounded-xl border border-border bg-surface-2 px-4 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15'

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
function useAvailability(username: string, email: string, on: boolean): { username: Free; email: Free } {
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
function FreeNote({ free, what }: { free: Free; what: 'username' | 'email' }): React.JSX.Element | null {
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

/** Sign in, create an account, or reset a forgotten password with a code sent by email. */
function SignedOut({ expired }: { expired: boolean }): React.JSX.Element {
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = (m: Mode): void => {
    setMode(m)
    setError(null)
    setPassword('')
    setCode('')
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'signin') {
        const res = await window.vanity.account.signIn(email, password, remember)
        if (res.error !== undefined) return setError(res.error)
        toast(res.data.username ? `Welcome back, ${res.data.username}` : 'Signed in')
      } else if (mode === 'signup') {
        const res = await window.vanity.account.signUp(email, username, password, remember)
        if (res.error !== undefined) return setError(res.error)
        toast(`Welcome to Vanity, ${res.data.username ?? username}!`)
      } else if (mode === 'forgot') {
        const res = await window.vanity.account.sendResetCode(email)
        if (res.error !== undefined) return setError(res.error)
        go('reset')
      } else {
        const res = await window.vanity.account.resetPassword(email, code, password)
        if (res.error !== undefined) return setError(res.error)
        toast('Password changed. Sign in with the new one.')
        go('signin')
      }
    } finally {
      setBusy(false)
    }
  }

  const free = useAvailability(username, email, mode === 'signup')
  const ready =
    mode === 'signin' ? !!email && !!password : mode === 'signup' ? !!email && !!username && password.length >= 8 && free.username !== false && free.email !== false : mode === 'forgot' ? !!email : code.length >= 4 && password.length >= 8

  return (
    <section className="rounded-2xl border border-border bg-surface p-6">
      {expired && mode === 'signin' && (
        <p className="mb-5 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          <KeyRound className="size-4 shrink-0" /> Your session has expired. Sign in again to carry on.
        </p>
      )}

      {mode === 'signin' || mode === 'signup' ? (
        <div className="mb-6 grid grid-cols-2 rounded-xl bg-surface-2 p-1">
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              onClick={() => go(m)}
              className={cn('rounded-lg py-2 text-sm font-semibold transition', mode === m ? 'bg-accent text-white shadow-lg shadow-accent/25' : 'text-muted hover:text-text')}
            >
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>
      ) : (
        <div className="mb-5">
          <button onClick={() => go('signin')} className="mb-3 flex items-center gap-1.5 text-sm text-muted transition hover:text-text">
            <ArrowLeft className="size-4" /> Back to sign in
          </button>
          <h2 className="text-lg font-semibold">{mode === 'forgot' ? 'Forgot your password?' : 'Choose a new password'}</h2>
          <p className="mt-1 text-sm text-muted">
            {mode === 'forgot'
              ? "Enter your account's email and we'll send you a 6-digit code."
              : `We sent a code to ${email}. It can take a minute, and may land in spam. Enter it below with your new password.`}
          </p>
        </div>
      )}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !busy) void submit()
        }}
      >
        {mode !== 'reset' && (
          <div>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input className={cn(input, 'pl-10', mode === 'signup' && free.email === false && 'border-accent')} type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus spellCheck={false} />
            </div>
            {mode === 'signup' && <FreeNote free={free.email} what="email" />}
          </div>
        )}
        {mode === 'signup' && (
          <div>
            <div className="relative">
              <AtSign className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input className={cn(input, 'pl-10', free.username === false && 'border-accent')} placeholder="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} maxLength={20} />
            </div>
            <FreeNote free={free.username} what="username" />
            <p className="mt-1.5 text-xs text-muted">3–20 letters, numbers or underscores. Friends add you by it; your email stays private.</p>
          </div>
        )}
        {mode === 'reset' && (
          <input
            className={cn(input, 'text-center font-mono text-lg tracking-[0.4em] placeholder:font-sans placeholder:text-sm placeholder:tracking-normal')}
            inputMode="numeric"
            placeholder="6-digit code"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
            autoFocus
            maxLength={10}
          />
        )}
        {mode !== 'forgot' && (
          <input
            className={input}
            type="password"
            placeholder={mode === 'signin' ? 'Password' : mode === 'reset' ? 'New password (at least 8 characters)' : 'Password (at least 8 characters)'}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}

        {(mode === 'signin' || mode === 'signup') && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <label className="flex cursor-pointer select-none items-center gap-2 text-muted">
              <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Stay signed in
            </label>
            {mode === 'signin' && (
              <button type="button" onClick={() => go('forgot')} className="text-muted underline-offset-4 transition hover:text-text hover:underline">
                Forgot password?
              </button>
            )}
          </div>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        <Button type="submit" variant="primary" className="h-11 w-full text-base" disabled={busy || !ready}>
          {mode === 'signin' ? (
            busy ? 'Signing in…' : 'Sign in'
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
            'Change password'
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
        Your password is checked by Vanity's sign-in service and never stored on this device. Staying signed in keeps an encrypted key in your device's secure storage.
      </p>
    </section>
  )
}

/** A signed-in account without a username yet (sign-up was interrupted, or the name got taken). */
function ChooseUsername({ email }: { email: string | null }): React.JSX.Element {
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
    <section className="rounded-2xl border border-border bg-surface p-6">
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
          <input className={cn(input, 'pl-10', free.username === false && 'border-accent')} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus spellCheck={false} maxLength={20} />
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
    </section>
  )
}

export function AccountPage(): React.JSX.Element {
  const account = useAccount()
  const toast = useToast()
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
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

  if (!account) return <div className="h-full" />

  return (
    <div className="h-full overflow-y-auto">
      <div className="stagger mx-auto w-full max-w-[1700px] space-y-6 px-10 pb-16 pt-12 max-md:px-4 max-md:pt-6">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>

        {!online && (
          <p className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
            <CloudOff className="size-4 shrink-0" /> You're offline. Your library still works; account features come back when you reconnect.
          </p>
        )}

        {/* The page is filled: your account on the left, linked accounts on the right (stacked on a narrow window). */}
        <div className="grid items-start gap-6 xl:grid-cols-2 [&>*:only-child]:col-span-full">
        {!account.available ? (
          <section className="rounded-2xl border border-border bg-surface p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
                <CloudOff className="size-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Accounts aren't switched on yet</h2>
                <p className="text-sm text-muted">This build of Vanity doesn't know where its account service is. Everything else works as usual.</p>
              </div>
            </div>
          </section>
        ) : !account.signedIn ? (
          <SignedOut expired={account.sessionExpired} />
        ) : account.needsUsername ? (
          <ChooseUsername email={account.email} />
        ) : (
          <section className="relative overflow-clip rounded-2xl border border-border bg-surface p-6">
            <div className="profile-banner h-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" data-banner={account.style.banner} data-fx={account.style.effect ?? 'none'} />
            <div className="relative flex items-center gap-5">
              <Avatar name={account.username ?? '?'} src={account.avatar} frame={account.style.frame} aura={account.style.aura} size="xl" status="online" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted">Signed in as</p>
                <p className="font-display text-3xl font-bold">
                  <UserName name={account.username ?? ''} style={account.style} verified={account.verified} admin={account.admin} badgeSize="lg" />
                </p>
                <ProfileTitle title={account.style.title} className="mb-1" />
                {account.email && <p className="truncate text-sm text-muted">{account.email}</p>}
                <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-400">
                  <ShieldCheck className="size-3.5 shrink-0" /> Your playtime and what you're playing are shared with your friends.
                </p>
              </div>
            </div>
            <ProfileEditor account={account} />
            <div className="relative mt-6 flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => navigate('/friends')}>
                <Users className="size-4" /> Friends
              </Button>
              <Button onClick={() => window.vanity.account.signOut().then(() => toast('Signed out'))}>
                <LogOut className="size-4" /> Sign out
              </Button>
              <Button variant="ghost" className="ml-auto hover:text-accent" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" /> Delete account
              </Button>
            </div>
            {!account.remembered && <p className="relative mt-4 text-xs text-muted">This device won't keep you signed in: you'll be signed out when Vanity closes.</p>}
          </section>
        )}

        <LinkedAccounts />
        </div>
      </div>

      {confirmDelete && (
        <Dialog
          title="Delete your account?"
          description="This removes your username, friends and shared stats from Vanity's servers. Your local library isn't affected."
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  const res = await window.vanity.account.deleteAccount()
                  setConfirmDelete(false)
                  if (res.error !== undefined) toast(res.error, 'error')
                  else toast('Account deleted')
                }}
              >
                Delete account
              </Button>
            </>
          }
        >
          <div className="p-6 text-sm text-muted">Your username becomes free for someone else. You can sign up again any time.</div>
        </Dialog>
      )}
    </div>
  )
}
