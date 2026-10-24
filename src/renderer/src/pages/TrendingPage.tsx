import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BellRing, CalendarDays, KeyRound, RefreshCw, TrendingUp, WifiOff } from 'lucide-react'
import type { StoreLauncher, TrendingGame, TrendingState, UpcomingGame } from '@shared/types'
import { MostHypedBanner } from '@/components/MostHypedBanner'
import { ReleaseCalendar } from '@/components/ReleaseCalendar'
import { Button } from '@/components/Dialog'
import { KeysDialog } from '@/components/KeysDialog'
import { LauncherPicker } from '@/components/LauncherPicker'
import { TrendingCard } from '@/components/TrendingCard'
import { cn } from '@/lib/cn'
import { formatAgo } from '@/lib/format'
import { useToast } from '@/state/toasts'

const GRID = { gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))' }

/** Anything with stores that can be opened: a trending or an upcoming game. */
type Openable = Pick<TrendingGame, 'id' | 'title' | 'stores'>

export function TrendingPage(): React.JSX.Element {
  const toast = useToast()
  const [state, setState] = useState<TrendingState | null>(null)
  const [installed, setInstalled] = useState<Partial<Record<StoreLauncher, boolean>>>({})
  const [picking, setPicking] = useState<Openable | null>(null)
  const [enteringKeys, setEnteringKeys] = useState(false)
  const [tab, setTab] = useState<'top' | 'calendar' | 'following'>('top')
  const [, setTick] = useState(0)

  useEffect(() => {
    window.vanity.trending.get().then(setState, () => {})
    window.vanity.trending.installed().then(setInstalled, () => {})
    const off = window.vanity.trending.onUpdate(setState)
    // Keep "Updated 12 min ago" current.
    const timer = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [])

  const refresh = useCallback(() => {
    setState((s) => (s ? { ...s, refreshing: true } : s))
    window.vanity.trending.refresh().then(setState, () => {})
  }, [])

  const open = useCallback(
    async (game: Openable, launcher: StoreLauncher) => {
      setPicking(null)
      const res = await window.vanity.trending.open(game.id, launcher)
      if (res.error !== undefined) toast(res.error, 'error')
      else if (res.data === 'browser') toast('Opened the store page in your browser')
    },
    [toast]
  )

  const select = useCallback(
    (game: Openable) => {
      if (game.stores.length === 1) void open(game, game.stores[0].launcher)
      else if (game.stores.length > 1) setPicking(game)
    },
    [open]
  )

  const follow = useCallback(
    async (game: UpcomingGame, on: boolean) => {
      // Show it straight away; the main process confirms with the saved list.
      setState((s) => (s ? { ...s, followed: on ? [...s.followed, game.id] : s.followed.filter((id) => id !== game.id) } : s))
      try {
        setState(await window.vanity.trending.follow(game.id, on))
        if (on) toast(`Following ${game.title}. You'll get a reminder when it comes out.`)
      } catch {
        toast(`Couldn't follow ${game.title}.`, 'error')
        window.vanity.trending.get().then(setState, () => {})
      }
    },
    [toast]
  )

  const games = state?.games ?? []
  const followed = state?.followed ?? []
  const refreshing = state?.refreshing ?? true

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-white/5 bg-bg/80 px-10 pb-5 pt-12 backdrop-blur-xl">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Trending</h1>
            <p className="mt-1 text-sm text-muted">The most popular PC games right now, across every store.</p>
          </div>
          <div className="ml-auto flex items-center gap-4">
            {state?.updatedAt && (
              <span className="text-sm text-muted" title={new Date(state.updatedAt).toLocaleString()}>
                Updated {formatAgo(state.updatedAt)}
              </span>
            )}
            <Button onClick={refresh} disabled={refreshing}>
              <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-10 pb-16 pt-8">
        {state?.error && games.length > 0 && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-accent" />
            <span className="flex-1">
              Couldn't update: {state.error} Showing the list from {formatAgo(state.updatedAt)}.
            </span>
            <button className="font-medium text-accent hover:underline" onClick={refresh} disabled={refreshing}>
              Retry
            </button>
          </div>
        )}

        {games.length > 0 ? (
          <>
            <MostHypedBanner games={state?.upcoming ?? []} followed={followed} onSelect={select as (g: UpcomingGame) => void} onFollow={follow} />
            <div className="mb-6 flex gap-1 rounded-xl border border-border bg-surface p-1 text-sm font-medium" role="tablist" style={{ width: 'fit-content' }}>
              {(
                [
                  ['top', 'Top right now', TrendingUp],
                  ['calendar', 'Release calendar', CalendarDays],
                  ['following', `Following${followed.length ? ` (${followed.length})` : ''}`, BellRing]
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn('flex items-center gap-2 rounded-lg px-3.5 py-2 transition', tab === id ? 'bg-accent text-white shadow' : 'text-muted hover:bg-white/5 hover:text-text')}
                >
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>
            {tab === 'top' ? (
              <div className="grid gap-x-6 gap-y-9" style={GRID}>
                {games.map((g, i) => (
                  <TrendingCard key={g.id} game={g} index={i} onSelect={select} />
                ))}
              </div>
            ) : (
              <ReleaseCalendar games={state?.upcoming ?? []} followed={followed} onSelect={select as (g: UpcomingGame) => void} onFollow={follow} onlyFollowed={tab === 'following'} />
            )}
          </>
        ) : state?.error && !refreshing ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-surface-2 ring-1 ring-border">
              {state.needsKeys ? <KeyRound className="size-7 text-muted" /> : <WifiOff className="size-7 text-muted" />}
            </div>
            <h2 className="text-lg font-semibold">{state.needsKeys ? 'API keys needed' : "Couldn't load trending games"}</h2>
            <p className="mt-1 max-w-md text-sm text-muted">
              {state.needsKeys
                ? 'Trending needs your Twitch client ID and secret (the same ones IGDB uses). Enter them here, or run "npm run setup-keys" in the project folder and restart.'
                : state.error}
            </p>
            <div className="mt-6 flex gap-3">
              {state.needsKeys && (
                <Button variant="primary" onClick={() => setEnteringKeys(true)}>
                  <KeyRound className="size-4" /> Enter keys
                </Button>
              )}
              <Button variant={state.needsKeys ? 'secondary' : 'primary'} onClick={refresh}>
                <RefreshCw className="size-4" /> Try again
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-x-6 gap-y-9" style={GRID} aria-label="Loading trending games">
            {Array.from({ length: 18 }, (_, i) => (
              <div key={i}>
                <div className="shimmer aspect-[2/3] rounded-xl bg-surface-2" />
                <div className="shimmer mt-3 h-3.5 w-3/4 rounded bg-surface-2" />
                <div className="shimmer mt-2 h-3 w-1/2 rounded bg-surface-2" />
                <div className="mt-2 flex gap-1">
                  <div className="shimmer size-5 rounded-[5px] bg-surface-2" />
                  <div className="shimmer size-5 rounded-[5px] bg-surface-2" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {enteringKeys && <KeysDialog onClose={() => setEnteringKeys(false)} />}
      {picking && (
        <LauncherPicker game={picking} installed={installed} onPick={(l) => open(picking, l)} onClose={() => setPicking(null)} />
      )}
    </div>
  )
}
