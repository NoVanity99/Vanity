import { useCallback, useEffect, useState } from 'react'
import { Check, Search } from 'lucide-react'
import type { Game, MatchCandidate } from '@shared/types'
import { cn } from '@/lib/cn'
import { useLibrary } from '@/state/library'
import { useToast } from '@/state/toasts'
import { Button, Dialog } from './Dialog'

/** Search IGDB (or SteamGridDB) and pick the right game when the automatic match is wrong or missing. */
export function MatchDialog({ game, onClose }: { game: Game; onClose: () => void }): React.JSX.Element {
  const { replaceGame } = useLibrary()
  const toast = useToast()
  const [query, setQuery] = useState(game.name)
  const [results, setResults] = useState<MatchCandidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [applying, setApplying] = useState<number | null>(null)

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return
    setSearching(true)
    setError(null)
    const res = await window.vanity.metadata.search(q)
    setSearching(false)
    if (res.error !== undefined) setError(res.error)
    else setResults(res.data)
  }, [])

  useEffect(() => {
    search(game.name)
  }, [game.name, search])

  async function apply(c: MatchCandidate): Promise<void> {
    setApplying(c.id)
    const res = await window.vanity.metadata.applyMatch(game.id, c)
    setApplying(null)
    if (res.error !== undefined) {
      toast(res.error, 'error')
      return
    }
    if (res.data) replaceGame(res.data)
    toast(`Matched to ${c.name}`)
    onClose()
  }

  const currentId = (c: MatchCandidate): boolean =>
    c.provider === 'igdb' ? c.id === game.metadata.igdbId : c.id === game.metadata.steamGridDbId

  return (
    <Dialog
      title="Fix match"
      description="Pick the game this really is. Its details and artwork will be downloaded again."
      onClose={onClose}
      size="xl"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <form
        className="sticky top-0 z-10 flex gap-2 border-b border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault()
          search(query)
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-3 text-sm outline-none focus:border-accent"
          />
        </div>
        <Button type="submit" variant="primary" disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </Button>
      </form>

      <div className="min-h-64 p-2">
        {error && <p className="p-4 text-sm text-accent">{error}</p>}
        {results?.length === 0 && !error && <p className="p-4 text-sm text-muted">No games found. Try a shorter or different name.</p>}
        <ul>
          {results?.map((c) => (
            <li key={`${c.provider}:${c.id}`}>
              <button
                onClick={() => apply(c)}
                disabled={applying !== null}
                className={cn(
                  'flex w-full items-center gap-4 rounded-xl p-2.5 text-left transition hover:bg-white/5 disabled:opacity-60',
                  applying === c.id && 'bg-white/5'
                )}
              >
                <div className="h-16 w-12 shrink-0 overflow-hidden rounded-md bg-surface-2 ring-1 ring-white/5">
                  {c.thumbUrl && <img src={c.thumbUrl} alt="" className="size-full object-cover" loading="lazy" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="text-xs text-muted">
                    {c.year ?? 'Unknown year'} · {c.provider === 'igdb' ? 'IGDB' : 'SteamGridDB'}
                  </p>
                </div>
                {applying === c.id ? (
                  <span className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                ) : (
                  currentId(c) && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <Check className="size-3.5" /> Current
                    </span>
                  )
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  )
}
