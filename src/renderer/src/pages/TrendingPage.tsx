import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, KeyRound, RefreshCw, WifiOff } from 'lucide-react'
import type { StoreLauncher, TrendingGame, TrendingState } from '@shared/types'
import { Button } from '@/components/Dialog'
import { LauncherPicker } from '@/components/LauncherPicker'
import { TrendingCard } from '@/components/TrendingCard'
import { cn } from '@/lib/cn'
import { formatAgo } from '@/lib/format'
import { useToast } from '@/state/toasts'

const GRID = { gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))' }

export function TrendingPage(): React.JSX.Element {
  const toast = useToast()
  const [state, setState] = useState<TrendingState | null>(null)
  const [installed, setInstalled] = useState<Partial<Record<StoreLauncher, boolean>>>({})
  const [picking, setPicking] = useState<TrendingGame | null>(null)
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
    async (game: TrendingGame, launcher: StoreLauncher) => {
      setPicking(null)
      const res = await window.vanity.trending.open(game.id, launcher)
      if (res.error !== undefined) toast(res.error, 'error')
      else if (res.data === 'browser') toast('Opened the store page in your browser')
    },
    [toast]
  )

  const select = useCallback(
    (game: TrendingGame) => {
      if (game.stores.length === 1) void open(game, game.stores[0].launcher)
      else if (game.stores.length > 1) setPicking(game)
    },
    [open]
  )

  const games = state?.games ?? []
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
          <div className="grid gap-x-6 gap-y-9" style={GRID}>
            {games.map((g, i) => (
              <TrendingCard key={g.id} game={g} index={i} onSelect={select} />
            ))}
          </div>
        ) : state?.error && !refreshing ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-surface-2 ring-1 ring-border">
              {state.needsKeys ? <KeyRound className="size-7 text-muted" /> : <WifiOff className="size-7 text-muted" />}
            </div>
            <h2 className="text-lg font-semibold">{state.needsKeys ? 'API keys needed' : "Couldn't load trending games"}</h2>
            <p className="mt-1 max-w-md text-sm text-muted">{state.error}</p>
            <div className="mt-6">
              <Button variant="primary" onClick={refresh}>
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

      {picking && (
        <LauncherPicker game={picking} installed={installed} onPick={(l) => open(picking, l)} onClose={() => setPicking(null)} />
      )}
    </div>
  )
}
