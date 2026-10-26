import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, Clock, Dices, FolderSearch, Image as ImageIcon, Layers, LayoutGrid, List, Pencil, Plus, Search, Sparkles, Star, Trash2, X } from 'lucide-react'
import { SurpriseDialog } from '@/components/SurpriseDialog'
import { openVibeCheck } from '@/components/VibeCheck'
import { PLAY_STATUS_LABELS, PLAY_STATUSES, SOURCE_LABELS, type Game, type GameSource, type PlayStatus } from '@shared/types'
import { Button } from '@/components/Dialog'
import { GameCard } from '@/components/GameCard'
import { GameRow, ROW_GRID } from '@/components/GameRow'
import { NameDialog } from '@/components/CollectionsDialog'
import { deleteCollection, renameCollection, useCollections } from '@/state/collections'
import { RecentShelf } from '@/components/RecentShelf'
import { useGameMenu } from '@/components/useGameMenu'
import { cn } from '@/lib/cn'
import { searchKey } from '@/lib/format'
import { loadPref, savePref } from '@/lib/storage'
import { useLibrary } from '@/state/library'

type View = 'all' | 'recent' | 'favorites' | 'collection'
type Sort = 'name' | 'recent' | 'added' | 'playtime' | 'rating' | 'release'

interface Prefs {
  sort: Sort
  source: GameSource | 'all'
  genre: string
  status: PlayStatus | 'none' | 'all'
  showHidden: boolean
  /** Minimum card width in px (the size slider). */
  cardWidth: number
  layout: 'grid' | 'list'
}

const DEFAULT_PREFS: Prefs = { sort: 'name', source: 'all', genre: 'all', status: 'all', showHidden: false, cardWidth: 168, layout: 'grid' }
const CARD_MIN = 128
const CARD_MAX = 260

const TITLES: Record<View, string> = { all: 'Library', recent: 'Recently Played', favorites: 'Favorites', collection: 'Collection' }

const byName = (a: Game, b: Game): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
const SORTERS: Record<Sort, (a: Game, b: Game) => number> = {
  name: byName,
  recent: (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || byName(a, b),
  added: (a, b) => b.addedAt - a.addedAt || byName(a, b),
  playtime: (a, b) => b.playtimeSeconds - a.playtimeSeconds || byName(a, b),
  rating: (a, b) => (b.userRating ?? 0) - (a.userRating ?? 0) || byName(a, b),
  release: (a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || byName(a, b)
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

/** /collection/:id: the library, showing one of your collections. */
export function CollectionPage(): React.JSX.Element {
  const { id } = useParams()
  const collections = useCollections()
  const collection = collections.find((c) => c.id === Number(id))
  if (!collection) return collections.length || !id ? <Navigate to="/library" replace /> : <div />
  return <LibraryPage key={collection.id} view="collection" collection={collection} />
}

export function LibraryPage({ view, collection }: { view: View; collection?: { id: number; name: string } }): React.JSX.Element {
  const { games, loading, scan, addManually, sessions, launch } = useLibrary()
  const navigate = useNavigate()
  const { openMenu, menu } = useGameMenu()
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  // Saved before newer options existed: fill in their defaults.
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...loadPref(`library-${view}`, DEFAULT_PREFS) }))
  const [players, setPlayers] = useState<Record<number, number>>({})
  const [surprise, setSurprise] = useState(false)
  const [renaming, setRenaming] = useState(false)

  // Live Steam player counts for the cards (cached in the main process for 10 minutes).
  useEffect(() => {
    let cancelled = false
    window.vanity.live.library().then(
      (p) => !cancelled && setPlayers(p),
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [])

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
    if (view === 'collection') return games.filter((g) => collection && g.collections.includes(collection.id))
    return games
  }, [games, view, collection])

  const sources = useMemo(() => [...new Set(base.map((g) => g.source))].sort(), [base])
  const genres = useMemo(() => [...new Set(base.flatMap((g) => g.genres))].sort(), [base])
  const hiddenCount = base.filter((g) => g.hidden).length
  // A saved filter for a source or genre that no longer has games would hide everything; ignore it.
  const source = prefs.source !== 'all' && sources.includes(prefs.source) ? prefs.source : 'all'
  const genre = prefs.genre !== 'all' && genres.includes(prefs.genre) ? prefs.genre : 'all'
  const tracked = base.some((g) => g.playStatus !== null)
  const status = tracked ? prefs.status : 'all'

  const shown = useMemo(() => {
    const q = searchKey(query.trim())
    const sort = view === 'recent' ? 'recent' : prefs.sort
    return base
      .filter((g) => prefs.showHidden || !g.hidden)
      .filter((g) => source === 'all' || g.source === source)
      .filter((g) => genre === 'all' || g.genres.includes(genre))
      .filter((g) => status === 'all' || (status === 'none' ? g.playStatus === null : g.playStatus === status))
      .filter((g) => !q || searchKey(g.name).includes(q))
      .sort(SORTERS[sort] ?? SORTERS.name)
  }, [base, query, prefs.showHidden, prefs.sort, source, genre, status, view])

  const filtered = query.trim() !== '' || source !== 'all' || genre !== 'all' || status !== 'all'
  const cardWidth = Math.min(CARD_MAX, Math.max(CARD_MIN, prefs.cardWidth || DEFAULT_PREFS.cardWidth))
  const gridStyle = { gridTemplateColumns: `repeat(auto-fill, minmax(${cardWidth}px, 1fr))` }
  const clearFilters = (): void => {
    setQuery('')
    patch({ source: 'all', genre: 'all', status: 'all' })
  }

  const openGame = useCallback((g: Game): void => void navigate(`/game/${g.id}`), [navigate])
  const playGame = useCallback((g: Game): void => void launch(g.id), [launch])

  // "Jump back in": the three most recent, on the main Library view when nothing is filtered.
  const recent = useMemo(
    () =>
      view === 'all' && !filtered
        ? games
            .filter((g) => g.lastPlayedAt !== null && !g.hidden)
            .sort(SORTERS.recent)
            .slice(0, 3)
        : [],
    [games, view, filtered]
  )

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 shrink-0 border-b border-white/5 bg-bg/80 px-10 pb-5 pt-12 backdrop-blur-xl">
        <div className="flex items-end gap-4">
          {view === 'collection' && <Layers className="mb-1.5 size-6 text-accent" />}
          <h1 className="text-3xl font-bold tracking-tight">{collection?.name ?? TITLES[view]}</h1>
          <span className="pb-1 text-sm tabular-nums text-muted">
            {shown.length}
            {shown.length !== base.length && ` of ${base.length}`} games
          </span>
          {collection && (
            <span className="ml-auto flex gap-2">
              <Button onClick={() => setRenaming(true)}>
                <Pencil className="size-4" /> Rename
              </Button>
              <Button
                onClick={async () => {
                  if (!window.confirm(`Delete the collection "${collection.name}"? The games stay in your library.`)) return
                  await deleteCollection(collection.id)
                  navigate('/library')
                }}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            </span>
          )}
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
                { value: 'added', label: 'Recently added' },
                { value: 'playtime', label: 'Most played' },
                { value: 'rating', label: 'Your rating' },
                { value: 'release', label: 'Release date' }
              ]}
            />
          )}

          {tracked && (
            <Select
              label="Status"
              value={status}
              onChange={(v) => patch({ status: v })}
              options={[
                { value: 'all', label: 'Any status' },
                ...PLAY_STATUSES.map((s) => ({ value: s, label: PLAY_STATUS_LABELS[s] })),
                { value: 'none', label: 'No status' }
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

          {view === 'all' && games.length > 1 && (
            <button
              onClick={openVibeCheck}
              title="What should I play right now? Pick your time and mood."
              className="group/vibe ml-auto flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent-2 px-3 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition hover:-translate-y-0.5 hover:brightness-110"
            >
              <Sparkles className="size-4 transition-transform duration-500 group-hover/vibe:rotate-180" />
              Vibe Check
            </button>
          )}

          {view === 'all' && games.length > 1 && (
            <button
              onClick={() => setSurprise(true)}
              className="group/dice flex h-9 items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 text-sm font-medium text-text transition hover:-translate-y-0.5 hover:bg-accent/20"
            >
              <Dices className="size-4 text-accent transition-transform duration-500 group-hover/dice:rotate-[360deg]" />
              Surprise me
            </button>
          )}

          <div
            className={cn('flex rounded-lg border border-border bg-surface-2 p-0.5', !(view === 'all' && games.length > 1) && 'ml-auto')}
            role="radiogroup"
            aria-label="Layout"
          >
            {(
              [
                ['grid', LayoutGrid, 'Grid'],
                ['list', List, 'List']
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                role="radio"
                aria-checked={prefs.layout === value}
                title={`${label} view`}
                onClick={() => patch({ layout: value })}
                className={cn(
                  'flex h-8 w-9 items-center justify-center rounded-md transition',
                  prefs.layout === value ? 'bg-accent text-white shadow' : 'text-muted hover:text-text'
                )}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>

          {prefs.layout === 'grid' && (
            <label className="flex items-center gap-2 text-muted" title="Card size">
              <ImageIcon className="size-3.5" />
              <input
                type="range"
                min={CARD_MIN}
                max={CARD_MAX}
                step={4}
                value={prefs.cardWidth}
                onChange={(e) => patch({ cardWidth: Number(e.target.value) })}
                className="h-1 w-28 cursor-pointer rounded-full accent-accent outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-4 focus-visible:ring-offset-bg"
                aria-label="Card size"
              />
              <ImageIcon className="size-5" />
            </label>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-10 pb-16 pt-8">
        {loading ? (
          <div className="grid gap-x-6 gap-y-8" style={gridStyle}>
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i}>
                <div className="shimmer aspect-[2/3] rounded-xl bg-surface-2" />
                <div className="shimmer mt-3 h-3.5 w-2/3 rounded bg-surface-2" />
              </div>
            ))}
          </div>
        ) : shown.length > 0 ? (
          <>
            <RecentShelf games={recent} onOpen={openGame} onMenu={openMenu} />
            {recent.length > 0 && <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted">All games</h2>}
            {prefs.layout === 'list' ? (
              <div>
                <div className={cn(ROW_GRID, 'border-b border-white/5 px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted')}>
                  <span />
                  <span>Game</span>
                  <span>Status</span>
                  <span>Rating</span>
                  <span className="text-right">Playtime</span>
                  <span className="text-right">Last played</span>
                  <span />
                </div>
                <div className="mt-1 space-y-0.5">
                  {shown.map((g, i) => (
                    <GameRow
                      key={g.id}
                      game={g}
                      index={i}
                      session={sessions[g.id]}
                      players={players[g.id]}
                      onOpen={openGame}
                      onPlay={playGame}
                      onMenu={openMenu}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid gap-x-6 gap-y-8" style={gridStyle}>
                {shown.map((g, i) => (
                  <GameCard
                    key={g.id}
                    game={g}
                    index={i}
                    session={sessions[g.id]}
                    players={players[g.id]}
                    onOpen={openGame}
                    onPlay={playGame}
                    onMenu={openMenu}
                  />
                ))}
              </div>
            )}
          </>
        ) : filtered ? (
          <EmptyState icon={Search} title="No games match" text="Try a different search or filter.">
            <Button onClick={clearFilters}>Clear filters</Button>
          </EmptyState>
        ) : view === 'recent' ? (
          <EmptyState icon={Clock} title="Nothing played yet" text="Games you launch from Vanity show up here." />
        ) : view === 'favorites' ? (
          <EmptyState icon={Star} title="No favorites yet" text="Right-click a game and choose Add to favorites." />
        ) : view === 'collection' ? (
          <EmptyState icon={Layers} title="This collection is empty" text="Right-click any game and choose Add to collection." />
        ) : scan.running ? (
          <EmptyState icon={FolderSearch} title="Looking for your games…" text="Checking Steam, Epic, GOG, EA, Ubisoft and your folders." />
        ) : (
          <EmptyState icon={FolderSearch} title="No games yet" text="Scan for installed games, or add one yourself.">
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
      {surprise && <SurpriseDialog onClose={() => setSurprise(false)} />}
      {renaming && collection && (
        <NameDialog
          title="Rename collection"
          initial={collection.name}
          confirm="Rename"
          onClose={() => setRenaming(false)}
          onSubmit={(name) => renameCollection(collection.id, name)}
        />
      )}
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
