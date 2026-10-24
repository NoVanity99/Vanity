import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Clock, FolderSearch, Plus, Search, Star, X } from 'lucide-react'
import { SOURCE_LABELS, type Game, type GameSource } from '@shared/types'
import { Button } from '@/components/Dialog'
import { GameCard } from '@/components/GameCard'
import { useGameMenu } from '@/components/useGameMenu'
import { cn } from '@/lib/cn'
import { searchKey } from '@/lib/format'
import { loadPref, savePref } from '@/lib/storage'
import { useLibrary } from '@/state/library'

type View = 'all' | 'recent' | 'favorites'
type Sort = 'name' | 'recent' | 'added'

interface Prefs {
  sort: Sort
  source: GameSource | 'all'
  genre: string
  showHidden: boolean
}

const DEFAULT_PREFS: Prefs = { sort: 'name', source: 'all', genre: 'all', showHidden: false }

const TITLES: Record<View, string> = { all: 'Library', recent: 'Recently Played', favorites: 'Favorites' }

const byName = (a: Game, b: Game): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
const SORTERS: Record<Sort, (a: Game, b: Game) => number> = {
  name: byName,
  recent: (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || byName(a, b),
  added: (a, b) => b.addedAt - a.addedAt || byName(a, b)
}

function Select<T extends string>({
  value,
  onChange,
  options,
  label
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
}): React.JSX.Element {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 cursor-pointer appearance-none rounded-lg border border-border bg-surface-2 pl-3 pr-8 text-sm outline-none transition hover:border-white/20 focus:border-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </label>
  )
}

export function LibraryPage({ view }: { view: View }): React.JSX.Element {
  const { games, loading, scan, addManually, sessions } = useLibrary()
  const navigate = useNavigate()
  const { openMenu, menu } = useGameMenu()
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [prefs, setPrefs] = useState<Prefs>(() => loadPref(`library-${view}`, DEFAULT_PREFS))

  useEffect(() => savePref(`library-${view}`, prefs), [view, prefs])
  const patch = (p: Partial<Prefs>): void => setPrefs((prev) => ({ ...prev, ...p }))

  // Ctrl+F focuses search; Escape clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The games this view is about, before search and filters.
  const base = useMemo(() => {
    if (view === 'recent') return games.filter((g) => g.lastPlayedAt !== null)
    if (view === 'favorites') return games.filter((g) => g.favorite)
    return games
  }, [games, view])

  const sources = useMemo(() => [...new Set(base.map((g) => g.source))].sort(), [base])
  const genres = useMemo(() => [...new Set(base.flatMap((g) => g.genres))].sort(), [base])
  const hiddenCount = base.filter((g) => g.hidden).length
  // A saved filter for a source or genre that no longer has games would hide everything; ignore it.
  const source = prefs.source !== 'all' && sources.includes(prefs.source) ? prefs.source : 'all'
  const genre = prefs.genre !== 'all' && genres.includes(prefs.genre) ? prefs.genre : 'all'

  const shown = useMemo(() => {
    const q = searchKey(query.trim())
    const sort = view === 'recent' ? 'recent' : prefs.sort
    return base
      .filter((g) => prefs.showHidden || !g.hidden)
      .filter((g) => source === 'all' || g.source === source)
      .filter((g) => genre === 'all' || g.genres.includes(genre))
      .filter((g) => !q || searchKey(g.name).includes(q))
      .sort(SORTERS[sort])
  }, [base, query, prefs.showHidden, prefs.sort, source, genre, view])

  const filtered = query.trim() !== '' || source !== 'all' || genre !== 'all'
  const clearFilters = (): void => {
    setQuery('')
    patch({ source: 'all', genre: 'all' })
  }

  const openGame = useCallback((g: Game): void => void navigate(`/game/${g.id}`), [navigate])

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 shrink-0 border-b border-white/5 bg-bg/80 px-10 pb-5 pt-12 backdrop-blur-xl">
        <div className="flex items-end gap-4">
          <h1 className="text-3xl font-bold tracking-tight">{TITLES[view]}</h1>
          <span className="pb-1 text-sm tabular-nums text-muted">
            {shown.length}
            {shown.length !== base.length && ` of ${base.length}`} games
          </span>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder="Search games"
              className="h-9 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-8 text-sm outline-none transition placeholder:text-muted hover:border-white/20 focus:border-accent"
            />
            {query && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-text"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {view !== 'recent' && (
            <Select
              label="Sort by"
              value={prefs.sort}
              onChange={(sort) => patch({ sort })}
              options={[
                { value: 'name', label: 'Name' },
                { value: 'recent', label: 'Recently played' },
                { value: 'added', label: 'Recently added' }
              ]}
            />
          )}

          {sources.length > 1 && (
            <Select
              label="Source"
              value={source}
              onChange={(v) => patch({ source: v })}
              options={[{ value: 'all', label: 'All sources' }, ...sources.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))]}
            />
          )}

          {genres.length > 0 && (
            <Select
              label="Genre"
              value={genre}
              onChange={(v) => patch({ genre: v })}
              options={[{ value: 'all', label: 'All genres' }, ...genres.map((g) => ({ value: g, label: g }))]}
            />
          )}

          {hiddenCount > 0 && (
            <button
              onClick={() => patch({ showHidden: !prefs.showHidden })}
              className={cn(
                'h-9 rounded-lg border px-3 text-sm transition',
                prefs.showHidden ? 'border-accent/50 bg-accent/10 text-text' : 'border-border text-muted hover:text-text'
              )}
            >
              {prefs.showHidden ? 'Showing' : 'Show'} {hiddenCount} hidden
            </button>
          )}

          {filtered && (
            <button onClick={clearFilters} className="text-sm text-muted transition hover:text-text">
              Clear filters
            </button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-10 pb-16 pt-8">
        {loading ? null : shown.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-6 gap-y-8">
            {shown.map((g) => (
              <GameCard key={g.id} game={g} playing={sessions[g.id] === 'running'} onOpen={openGame} onMenu={openMenu} />
            ))}
          </div>
        ) : filtered ? (
          <EmptyState icon={Search} title="No games match" text="Try a different search or filter.">
            <Button onClick={clearFilters}>Clear filters</Button>
          </EmptyState>
        ) : view === 'recent' ? (
          <EmptyState icon={Clock} title="Nothing played yet" text="Games you launch from Vanity show up here." />
        ) : view === 'favorites' ? (
          <EmptyState icon={Star} title="No favorites yet" text="Right-click a game and choose Add to favorites." />
        ) : scan.running ? (
          <EmptyState icon={FolderSearch} title="Looking for your games…" text="Checking Steam, Epic, GOG, EA, Ubisoft and your folders." />
        ) : (
          <EmptyState
            icon={FolderSearch}
            title="No games yet"
            text="Scan for installed games, or add one yourself."
          >
            <Button variant="primary" onClick={scan.start}>
              Scan for games
            </Button>
            <Button onClick={addManually}>
              <Plus className="size-4" /> Add a game
            </Button>
          </EmptyState>
        )}
      </div>
      {menu}
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  text,
  children
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  text: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-surface-2 ring-1 ring-border">
        <Icon className="size-7 text-muted" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>
      {children && <div className="mt-6 flex gap-3">{children}</div>}
    </div>
  )
}
