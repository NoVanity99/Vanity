import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Globe, LogOut, Server, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { Button, Dialog } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import { useAccount } from '@/state/account'
import { useToast } from '@/state/toasts'

const input =
  'h-11 w-full rounded-xl border border-border bg-surface-2 px-4 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15'

function ServerForm({ current, onSaved }: { current: string; onSaved?: () => void }): React.JSX.Element {
  const toast = useToast()
  const [url, setUrl] = useState(current)
  const [busy, setBusy] = useState(false)
  useEffect(() => setUrl(current), [current])

  const save = async (): Promise<void> => {
    setBusy(true)
    const res = await window.vanity.account.setServer(url)
    setBusy(false)
    if (res.error !== undefined) toast(res.error, 'error')
    else {
      toast(res.data.serverConfigured ? 'Connected to your Vanity server' : 'Server removed')
      onSaved?.()
    }
  }

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="relative flex-1">
        <Globe className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input className={cn(input, 'pl-10')} placeholder="https://your-project.vercel.app" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
      </div>
      <Button type="submit" disabled={busy || url.trim() === current}>
        {busy ? 'Checking…' : 'Connect'}
      </Button>
    </form>
  )
}

export function AccountPage(): React.JSX.Element {
  const account = useAccount()
  const toast = useToast()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = mode === 'login' ? await window.vanity.account.login(username, password) : await window.vanity.account.register(username, password)
    setBusy(false)
    if (res.error !== undefined) setError(res.error)
    else {
      setPassword('')
      toast(mode === 'login' ? `Welcome back, ${res.data.username}` : `Welcome to Vanity, ${res.data.username}!`)
    }
  }

  if (!account) return <div className="h-full" />

  return (
    <div className="h-full overflow-y-auto">
      <div className="stagger mx-auto max-w-xl space-y-6 px-10 pb-16 pt-12">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>

        {!account.serverConfigured ? (
          <section className="rounded-2xl border border-border bg-surface p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
                <Server className="size-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Connect your Vanity server</h2>
                <p className="text-sm text-muted">Accounts and friends run on your own server (Neon database). See server/README.md to set it up.</p>
              </div>
            </div>
            <div className="mt-5">
              <ServerForm current="" />
            </div>
          </section>
        ) : account.signedIn ? (
          <>
            <section className="relative overflow-hidden rounded-2xl border border-border bg-surface p-6">
              <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-accent/20 blur-3xl" />
              <div className="relative flex items-center gap-5">
                <Avatar name={account.username ?? '?'} size="xl" status="online" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted">Signed in as</p>
                  <p className="truncate font-display text-3xl font-bold">{account.username}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-400">
                    <ShieldCheck className="size-3.5" /> Your playtime and what you're playing are shared with your friends.
                  </p>
                </div>
              </div>
              <div className="relative mt-6 flex flex-wrap gap-3">
                <Button variant="primary" onClick={() => navigate('/friends')}>
                  <Users className="size-4" /> Friends
                </Button>
                <Button onClick={() => window.vanity.account.logout().then(() => toast('Signed out'))}>
                  <LogOut className="size-4" /> Sign out
                </Button>
                <Button variant="ghost" className="ml-auto hover:text-accent" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-4" /> Delete account
                </Button>
              </div>
            </section>
          </>
        ) : (
          <section className="rounded-2xl border border-border bg-surface p-6">
            <div className="mb-6 grid grid-cols-2 rounded-xl bg-surface-2 p-1">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m)
                    setError(null)
                  }}
                  className={cn('rounded-lg py-2 text-sm font-semibold transition', mode === m ? 'bg-accent text-white shadow-lg shadow-accent/25' : 'text-muted hover:text-text')}
                >
                  {m === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <input className={input} placeholder="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus spellCheck={false} />
              <input
                className={input}
                type="password"
                placeholder={mode === 'register' ? 'Password (at least 8 characters)' : 'Password'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode === 'register' && <p className="text-xs text-muted">Usernames are 3–20 letters, numbers or underscores. Friends add you by it.</p>}
              {error && <p className="animate-pop-in rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">{error}</p>}
              <Button type="submit" variant="primary" className="h-11 w-full text-base" disabled={busy || !username || !password}>
                {mode === 'login' ? (busy ? 'Signing in…' : 'Sign in') : busy ? 'Creating…' : (
                  <>
                    <UserPlus className="size-4" /> Create account
                  </>
                )}
              </Button>
            </form>
          </section>
        )}

        {account.serverConfigured && (
          <section className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="flex items-center gap-2 font-semibold">
              <Server className="size-4 text-muted" /> Server
            </h2>
            <p className="mb-4 mt-1 text-sm text-muted">Everyone you want to be friends with must use the same server. Changing it signs you out.</p>
            <ServerForm current={account.serverUrl} />
          </section>
        )}
      </div>

      {confirmDelete && (
        <Dialog
          title="Delete your account?"
          description="This removes your account, friends and shared stats from the server. Your local library isn't affected."
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
          <div className="p-6 text-sm text-muted">You can create a new account any time.</div>
        </Dialog>
      )}
    </div>
  )
}
