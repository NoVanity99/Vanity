import { useEffect, useState } from 'react'
import { BadgeCheck, ExternalLink, EyeOff, Gamepad2, Link2, Loader2, LogIn, RefreshCw, Trophy, Unlink } from 'lucide-react'
import type { SteamState } from '@shared/types'
import { Button } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import { useStores } from '@/state/downloads'
import { useToast } from '@/state/toasts'

const input =
  'h-11 w-full rounded-xl border border-border bg-surface-2 px-4 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15'

export function useSteam(): SteamState | null {
  const [state, setState] = useState<SteamState | null>(null)
  useEffect(() => {
    window.vanity.steam.state().then(setState, () => {})
    return window.vanity.steam.onChange(setState)
  }, [])
  return state
}

function SteamLogo({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M11.98 0C5.67 0 .5 4.86.03 11.05l6.43 2.66a3.38 3.38 0 0 1 1.91-.59l.19.01 2.86-4.14v-.06a4.53 4.53 0 1 1 4.53 4.53h-.1l-4.08 2.91.01.16a3.4 3.4 0 0 1-6.74.66L.43 15.28A12 12 0 1 0 11.98 0ZM7.54 18.21l-1.47-.61a2.55 2.55 0 1 0 1.4-3.42l1.52.63a1.88 1.88 0 1 1-1.45 3.4Zm11.43-9.28a3.02 3.02 0 1 0-6.04 0 3.02 3.02 0 0 0 6.04 0Zm-5.28 0a2.27 2.27 0 1 1 4.54 0 2.27 2.27 0 0 1-4.54 0Z" />
    </svg>
  )
}

/** The Steam part of "Linked accounts": link by id, link, or name; or by signing in through Steam. */
function SteamCard({ steam }: { steam: SteamState }): React.JSX.Element {
  const toast = useToast()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState<'link' | 'signin' | 'unlink' | 'refresh' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // An avatar that fails to load (offline) falls back to the Steam logo.
  const [avatarFailed, setAvatarFailed] = useState<string | null>(null)

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<{ error?: string } | SteamState>, done?: string): Promise<void> => {
    setBusy(kind)
    setError(null)
    try {
      const res = await fn()
      if ('error' in res && typeof res.error === 'string') setError(res.error)
      else if (done) toast(done)
    } finally {
      setBusy(null)
    }
  }

  const link = steam.link
  const notSetUp = steam.configured === false

  return (
    <div className="rounded-xl border border-border bg-surface-2/60 p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#1b2838] text-white">
          <SteamLogo className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Steam</p>
          <p className="truncate text-xs text-muted">{link ? 'Linked' : 'Shows your Steam games and counts your achievements towards XP.'}</p>
        </div>
        {link && (
          <button
            onClick={() => run('refresh', () => window.vanity.steam.refresh())}
            disabled={busy !== null}
            title="Check Steam again"
            aria-label="Check Steam again"
            className="rounded-lg p-2 text-muted transition hover:bg-white/10 hover:text-text disabled:opacity-50"
          >
            <RefreshCw className={cn('size-4', busy === 'refresh' && 'animate-spin')} />
          </button>
        )}
      </div>

      {link ? (
        <>
          <div className="mt-4 flex items-center gap-4 rounded-xl bg-black/25 p-3">
            {link.avatar && avatarFailed !== link.avatar ? (
              <img src={link.avatar} alt="" className="size-14 shrink-0 rounded-xl object-cover ring-1 ring-white/10" draggable={false} onError={() => setAvatarFailed(link.avatar)} />
            ) : (
              <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-white/5 text-muted">
                <SteamLogo className="size-7" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5">
                <span className="truncate text-lg font-bold">{link.name}</span>
                {link.verified && (
                  <span title="You proved this account is yours by signing in through Steam" className="flex shrink-0 items-center text-sky-400">
                    <BadgeCheck className="size-4" />
                  </span>
                )}
              </p>
              <p className="truncate font-mono text-xs text-muted">{link.steamId}</p>
              <a href={link.profileUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted underline-offset-4 transition hover:text-text hover:underline">
                Steam profile <ExternalLink className="size-3" />
              </a>
            </div>
            <Button onClick={() => run('unlink', () => window.vanity.steam.unlink(), 'Steam unlinked')} disabled={busy !== null}>
              <Unlink className="size-4" /> {busy === 'unlink' ? 'Unlinking…' : 'Unlink'}
            </Button>
          </div>

          {steam.gamesPrivate ? (
            <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
              <p className="flex items-center gap-2 font-semibold">
                <EyeOff className="size-4 shrink-0" /> Steam isn't sharing this account's games
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-amber-100/90">
                <li>In Steam, click your name at the top, then <b>Profile</b>.</li>
                <li>Click <b>Edit Profile</b>, then <b>Privacy Settings</b>.</li>
                <li>Set <b>My profile</b> to <b>Public</b>.</li>
                <li>Set <b>Game details</b> to <b>Public</b>.</li>
                <li>Wait a few minutes, then press the refresh button above.</li>
              </ol>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <p className="flex items-center gap-2 rounded-xl bg-black/20 px-3 py-2.5">
                <Gamepad2 className="size-4 shrink-0 text-muted" />
                <span>
                  <b className="tabular-nums">{steam.ownedGames === null ? '…' : steam.ownedGames.toLocaleString()}</b> <span className="text-muted">games</span>
                </span>
              </p>
              <p className="flex items-center gap-2 rounded-xl bg-black/20 px-3 py-2.5" title={steam.achievements && !steam.achievements.complete ? 'Still counting: big libraries take a few minutes' : undefined}>
                <Trophy className="size-4 shrink-0 text-muted" />
                <span>
                  <b className="tabular-nums">{steam.achievements ? steam.achievements.unlocked.toLocaleString() : '…'}</b> <span className="text-muted">achievements{steam.achievements && !steam.achievements.complete ? ' (counting…)' : ''}</span>
                </span>
              </p>
            </div>
          )}
        </>
      ) : steam.signingIn ? (
        <div className="mt-4 rounded-xl bg-black/25 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <Loader2 className="size-4 animate-spin" /> Waiting for you to sign in on Steam's page…
          </p>
          <p className="mt-1 text-muted">Your browser opened Steam's sign-in page. Sign in there and this fills in by itself. Vanity never sees your Steam password.</p>
          <button onClick={() => void window.vanity.steam.cancelSignIn()} className="mt-3 text-muted underline-offset-4 transition hover:text-text hover:underline">
            Cancel
          </button>
        </div>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim() && busy === null) void run('link', () => window.vanity.steam.link(value), 'Steam linked')
          }}
        >
          <div className="flex gap-2">
            <input className={input} placeholder="SteamID, profile link or custom URL name" value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} disabled={notSetUp} aria-label="Steam account" />
            <Button type="submit" variant="primary" className="h-11 shrink-0" disabled={!value.trim() || busy !== null || notSetUp}>
              <Link2 className="size-4" /> {busy === 'link' ? 'Linking…' : 'Link'}
            </Button>
          </div>
          <p className="text-xs text-muted">
            Any of these work: <span className="font-mono">76561198000000000</span>, <span className="font-mono">steamcommunity.com/profiles/7656…</span>, <span className="font-mono">steamcommunity.com/id/yourname</span>, or just <span className="font-mono">yourname</span>.
          </p>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>
          <Button type="button" className="h-11 w-full" disabled={busy !== null || notSetUp} onClick={() => run('signin', () => window.vanity.steam.signIn())}>
            <LogIn className="size-4" /> {busy === 'signin' ? 'Opening Steam…' : 'Sign in through Steam'}
          </Button>
        </form>
      )}

      {notSetUp && !link && <p className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-sm text-muted">Steam linking isn't switched on yet: Vanity's server doesn't have its Steam key.</p>}
      {(error ?? steam.error) && (
        <p role="alert" className="animate-pop-in mt-3 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
          {error ?? steam.error}
        </p>
      )}
    </div>
  )
}

/** Account settings: the outside accounts linked to your Vanity account. */
/** One store whose sign-in lives on this PC (Epic through Legendary, GOG). */
function StoreCard({
  name,
  blurb,
  tile,
  account,
  onSignIn,
  onSignOut,
  children
}: {
  name: string
  blurb: string
  tile: React.ReactNode
  account: { signedIn: boolean; name: string | null; games: number | null; busy: boolean; error: string | null }
  onSignIn: () => Promise<{ error?: string } | unknown>
  onSignOut: () => Promise<unknown>
  children?: React.ReactNode
}): React.JSX.Element {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<{ error?: string } | unknown>, done?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = (await fn()) as { error?: string } | undefined
      if (res && typeof res.error === 'string') setError(res.error)
      else if (done) toast(done)
    } finally {
      setBusy(false)
    }
  }
  const working = busy || account.busy
  return (
    <div className="rounded-xl border border-border bg-surface-2/60 p-4" data-store={name}>
      <div className="flex items-center gap-3">
        {tile}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{name}</p>
          <p className="truncate text-xs text-muted">
            {account.signedIn ? (
              <>
                Signed in as <span className="font-semibold text-text">{account.name ?? 'your account'}</span>
                {account.games !== null && ` · ${account.games.toLocaleString()} game${account.games === 1 ? '' : 's'}`}
              </>
            ) : (
              blurb
            )}
          </p>
        </div>
        {account.signedIn ? (
          <Button onClick={() => run(onSignOut, `Signed out of ${name}`)} disabled={working}>
            <Unlink className="size-4" /> Unlink
          </Button>
        ) : (
          <Button variant="primary" onClick={() => run(onSignIn)} disabled={working}>
            {working ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />} {working ? 'Signing in…' : 'Sign in'}
          </Button>
        )}
      </div>
      {!account.signedIn && children}
      {(error ?? account.error) && (
        <p role="alert" className="animate-pop-in mt-3 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
          {error ?? account.error}
        </p>
      )}
    </div>
  )
}

/** If Epic's sign-in window doesn't finish by itself, the code on its last page can be pasted here. */
function EpicCodeEntry(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 text-xs text-muted underline-offset-4 transition hover:text-text hover:underline">
        Sign-in window didn't work? Enter a code instead
      </button>
    )
  }
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        const res = await window.vanity.stores.epicLoginWithCode(code)
        setBusy(false)
        if (res.error !== undefined) setError(res.error)
      }}
    >
      <p className="text-xs text-muted">
        Open{' '}
        <a href="https://legendary.gl/epiclogin" target="_blank" rel="noreferrer" className="text-text underline underline-offset-4">
          legendary.gl/epiclogin
        </a>{' '}
        in your browser and sign in to Epic. The page ends on a line of text containing <span className="font-mono">"authorizationCode"</span>: copy the value in quotes after it and paste it here.
      </p>
      <div className="flex gap-2">
        <input className={input} placeholder="authorizationCode" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} aria-label="Epic sign-in code" />
        <Button type="submit" className="h-11 shrink-0" disabled={busy || !code.trim()}>
          {busy ? 'Checking…' : 'Use code'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
          {error}
        </p>
      )}
    </form>
  )
}

/** Account settings: the outside accounts linked to Vanity. */
export function LinkedAccounts(): React.JSX.Element | null {
  const steam = useSteam()
  const stores = useStores()
  if (!steam && !stores) return null
  const onPc = stores?.supported === true
  // On a phone there is only Steam, and that needs a Vanity account.
  if (!onPc && !steam?.available) return null
  return (
    <section className="rounded-2xl border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold">Linked accounts</h2>
      <p className="mb-4 mt-1 text-sm text-muted">Connect your other gaming accounts, so their games show in your library.</p>
      <div className="space-y-3">
        {steam?.available ? (
          <SteamCard steam={steam} />
        ) : (
          <p className="rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm text-muted">
            <span className="font-semibold text-text">Steam</span>: sign in to your Vanity account to link it (the link is saved to your account, so it follows you to every device).
          </p>
        )}
        {onPc && stores && (
          <>
            {stores.epic.available ? (
              <StoreCard
                name="Epic Games"
                blurb="Install and play your Epic games from Vanity."
                tile={<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#2a2a2a] text-xs font-black tracking-tight text-white">EPIC</span>}
                account={stores.epic}
                onSignIn={() => window.vanity.stores.epicLogin()}
                onSignOut={() => window.vanity.stores.epicLogout()}
              >
                <EpicCodeEntry />
              </StoreCard>
            ) : (
              <p className="rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm text-muted">
                <span className="font-semibold text-text">Epic Games</span>: this build of Vanity doesn't include the Epic downloader.
              </p>
            )}
            <StoreCard
              name="GOG"
              blurb="Install your GOG games from Vanity."
              tile={<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#7c3aed] text-xs font-black tracking-tight text-white">GOG</span>}
              account={stores.gog}
              onSignIn={() => window.vanity.stores.gogLogin()}
              onSignOut={() => window.vanity.stores.gogLogout()}
            />
            <p className="text-xs text-muted">Epic and GOG sign-ins stay on this PC: a window opens on the store's own sign-in page, and Vanity never sees your password.</p>
          </>
        )}
      </div>
    </section>
  )
}
