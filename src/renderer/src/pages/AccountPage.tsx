import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CloudOff, LogOut, ShieldCheck, Trash2, Users } from 'lucide-react'
import { STATS_VISIBILITY_LABELS, type AccountState, type StatsVisibility } from '@shared/types'
import { Avatar } from '@/components/Avatar'
import { Button, Dialog } from '@/components/Dialog'
import { LinkedAccounts } from '@/components/LinkedAccounts'
import { OverlaySettingsPanel } from '@/components/settings/OverlaySettingsPanel'
import { ProfileEditor } from '@/components/ProfileEditor'
import { ProfileTitle, UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { useAccount } from '@/state/account'
import { useToast } from '@/state/toasts'

/** Who can see your profile and stats: everyone (the default), friends, or only you. */
function StatsPrivacy({ account }: { account: AccountState }): React.JSX.Element {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const pick = async (v: StatsVisibility): Promise<void> => {
    if (v === account.statsVisibility) return
    setBusy(true)
    const r = await window.vanity.account.setProfile({ statsVisibility: v }).catch(() => null)
    setBusy(false)
    if (!r || r.error !== undefined) toast(r?.error ?? "Couldn't change that.", 'error')
    else toast(`Profile: ${STATS_VISIBILITY_LABELS[v].label.toLowerCase()} can see it`)
  }
  return (
    <div className="relative mt-5 border-t border-border pt-4" data-stats-privacy>
      <p className="text-xs font-semibold text-muted">Who can see my profile and stats</p>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Who can see my profile and stats">
        {(Object.keys(STATS_VISIBILITY_LABELS) as StatsVisibility[]).map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={account.statsVisibility === v}
            disabled={busy}
            onClick={() => void pick(v)}
            className={cn('rounded-lg border px-3 py-1.5 text-sm font-semibold transition', account.statsVisibility === v ? 'border-accent bg-accent/15 text-text ring-2 ring-accent/30' : 'border-border text-muted hover:border-white/25 hover:text-text')}
            data-visibility={v}
          >
            {STATS_VISIBILITY_LABELS[v].label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">{STATS_VISIBILITY_LABELS[account.statsVisibility].hint}</p>
    </div>
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
        ) : !account.signedIn || account.needsUsername ? (
          // The log-in pop-up is in front of everything until this is sorted out (components/auth/AuthGate).
          <section className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">Log in to see your account.</section>
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
            <StatsPrivacy account={account} />
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

        <div className="space-y-6">
          <LinkedAccounts />
          <OverlaySettingsPanel />
        </div>
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
