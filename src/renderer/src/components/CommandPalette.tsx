import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDownToLine,
  BarChart3,
  Clock,
  CornerDownLeft,
  Flame,
  FolderSearch,
  Layers,
  LayoutGrid,
  Play,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  Star,
  UserCircle2,
  Users,
  type LucideIcon
} from 'lucide-react'
import type { Game } from '@shared/types'
import { cn } from '@/lib/cn'
import { formatPlaytime } from '@/lib/format'
import { matchScore } from '@/lib/fuzzy'
import { mediaUrl, nameHue } from '@/lib/media'
import { useCollections } from '@/state/collections'
import { useLibrary } from '@/state/library'
import { checkForUpdate } from '@/state/update'
import { useToast } from '@/state/toasts'

// Opening from anywhere (sidebar button, shortcut).
const openers = new Set<() => void>()
export function openCommandPalette(): void {
  for (const fn of openers) fn()
}

interface Item {
  id: string
  group: 'Games' | 'Go to' | 'Actions'
  label: string
  sub?: string
  icon?: LucideIcon
  game?: Game
  run: () => void
  /** Ctrl+Enter: play, for games. */
  alt?: () => void
}

const MAX_GAMES = 8

function Thumb({ game }: { game: Game }): React.JSX.Element {
  const cover = mediaUrl(game.coverPath)
  const hue = nameHue(game.name)
  return (
    <span className="block h-10 w-[30px] shrink-0 overflow-hidden rounded ring-1 ring-white/10" style={{ background: `hsl(${hue} 40% 22%)` }}>
      {cover && <img src={cover} alt="" className="size-full object-cover" draggable={false} />}
    </span>
  )
}

/** Ctrl+K: jump to any game, page or action by typing. */
export function CommandPalette(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = (): void => setOpen(true)
    openers.add(show)
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'p')) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      openers.delete(show)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  return open ? <Palette onClose={() => setOpen(false)} /> : null
}

function Palette({ onClose }: { onClose: () => void }): React.JSX.Element {
  const navigate = useNavigate()
  const toast = useToast()
  const { games, launch, scan, addManually, sessions } = useLibrary()
  const collections = useCollections()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const go = useCallback(
    (path: string) => () => {
      navigate(path)
    },
    [navigate]
  )

  const items = useMemo((): Item[] => {
    const q = query.trim()
    const visible = games.filter((g) => !g.hidden)
    const gameItems = (
      q
        ? visible
            .map((g) => ({ g, s: matchScore(q, g.name) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s || (b.g.lastPlayedAt ?? 0) - (a.g.lastPlayedAt ?? 0))
            .map((x) => x.g)
        : visible.filter((g) => g.lastPlayedAt).sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
    )
      .slice(0, MAX_GAMES)
      .map(
        (g): Item => ({
          id: `game-${g.id}`,
          group: 'Games',
          label: g.name,
          sub: sessions[g.id] ? 'Playing now' : g.playtimeSeconds ? formatPlaytime(g.playtimeSeconds) : 'Not played yet',
          game: g,
          run: go(`/game/${g.id}`),
          alt: () => void launch(g.id)
        })
      )
    const pages: Item[] = [
      { id: 'p-library', group: 'Go to', label: 'Library', icon: LayoutGrid, run: go('/library') },
      { id: 'p-trending', group: 'Go to', label: 'Trending', icon: Flame, run: go('/trending') },
      { id: 'p-store', group: 'Go to', label: 'Steam Store', icon: ShoppingBag, run: go('/store') },
      { id: 'p-friends', group: 'Go to', label: 'Friends', icon: Users, run: go('/friends') },
      { id: 'p-recent', group: 'Go to', label: 'Recently Played', icon: Clock, run: go('/recent') },
      { id: 'p-favorites', group: 'Go to', label: 'Favorites', icon: Star, run: go('/favorites') },
      { id: 'p-stats', group: 'Go to', label: 'Stats', icon: BarChart3, run: go('/stats') },
      { id: 'p-settings', group: 'Go to', label: 'Settings', icon: Settings, run: go('/settings') },
      { id: 'p-account', group: 'Go to', label: 'Account', icon: UserCircle2, run: go('/account') },
      ...collections.map((c): Item => ({ id: `c-${c.id}`, group: 'Go to', label: c.name, sub: 'Collection', icon: Layers, run: go(`/collection/${c.id}`) }))
    ]
    const actions: Item[] = [
      { id: 'a-scan', group: 'Actions', label: scan.running ? 'Scanning for games…' : 'Scan for games', icon: FolderSearch, run: () => void scan.start() },
      { id: 'a-add', group: 'Actions', label: 'Add a game', icon: Plus, run: () => void addManually() },
      {
        id: 'a-update',
        group: 'Actions',
        label: 'Check for updates',
        icon: ArrowDownToLine,
        run: () =>
          void checkForUpdate().then((s) => toast(s.available ? `v${s.latest} is ready: use the update button at the top right` : s.error ?? `You're up to date (v${s.current})`))
      }
    ]
    const rank = (xs: Item[]): Item[] =>
      q
        ? xs
            .map((x) => ({ x, s: Math.max(matchScore(q, x.label), x.sub ? matchScore(q, x.sub) / 2 : 0) }))
            .filter((r) => r.s > 0)
            .sort((a, b) => b.s - a.s)
            .map((r) => r.x)
        : xs
    return [...gameItems, ...rank(pages), ...rank(actions)]
  }, [query, games, collections, sessions, scan, addManually, launch, go, toast])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (item: Item | undefined, alt = false): void => {
    if (!item) return
    onClose()
    if (alt && item.alt) item.alt()
    else item.run()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(items.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(items[active], e.ctrlKey || e.metaKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  let lastGroup: string | null = null
  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-[fade-in_120ms_ease-out] justify-center bg-black/60 px-6 pt-[14vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Search Vanity" className="flex h-fit max-h-[70vh] w-full max-w-xl animate-[dialog-in_160ms_ease-out] flex-col overflow-hidden rounded-2xl border border-border bg-surface/95 shadow-2xl shadow-black/60 backdrop-blur-xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-5 shrink-0 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search games, pages and actions…"
            aria-activedescendant={items[active] ? `cmd-${items[active].id}` : undefined}
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-2" role="listbox">
          {items.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">Nothing matches "{query}".</p>}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? (item.group === 'Games' && !query.trim() ? 'Recently played' : item.group) : null
            lastGroup = item.group
            const Icon = item.icon
            return (
              <div key={item.id}>
                {header && <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-widest text-muted/80 first:pt-1">{header}</p>}
                <button
                  id={`cmd-${item.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={(e) => choose(item, e.ctrlKey || e.metaKey)}
                  className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors', i === active ? 'bg-accent/15 text-text' : 'text-text/85')}
                >
                  {item.game ? (
                    <Thumb game={item.game} />
                  ) : (
                    Icon && (
                      <span className="flex size-[30px] shrink-0 items-center justify-center rounded-md bg-white/5">
                        <Icon className="size-4 text-muted" />
                      </span>
                    )
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.label}</span>
                    {item.sub && <span className="block truncate text-xs text-muted">{item.sub}</span>}
                  </span>
                  {i === active && (
                    <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted">
                      {item.alt && (
                        <span className="flex items-center gap-1">
                          <Play className="size-3" /> Ctrl+Enter
                        </span>
                      )}
                      <CornerDownLeft className="size-3.5" />
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}
