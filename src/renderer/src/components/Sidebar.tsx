import { useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { BarChart3, Clock, Flame, Gamepad2, Layers, LayoutGrid, Plus, Search, Settings, ShoppingBag, Star, Tv, UserCircle2, Users, type LucideIcon } from 'lucide-react'
import { createCollection, useCollections } from '@/state/collections'
import { openCommandPalette } from './CommandPalette'
import { NameDialog } from './CollectionsDialog'
import { LevelBadge } from './LevelBadge'
import { useAccount } from '@/state/account'
import { Avatar } from './Avatar'
import { cn } from '@/lib/cn'
import { useLibrary } from '@/state/library'

type IconAnimation = 'bounce' | 'flame' | 'rewind' | 'star' | 'gear' | 'plus' | 'swing' | 'wave'

/** Replays an icon animation on each click: a new key remounts the icon with the animation class. */
function useClickAnimation(): [number, () => void] {
  const [n, setN] = useState(0)
  return [n, () => setN((x) => x + 1)]
}

function NavItem({
  to,
  icon: Icon,
  label,
  count,
  animation
}: {
  to: string
  icon: LucideIcon
  label: string
  count?: number
  animation: IconAnimation
}): React.JSX.Element {
  const [played, play] = useClickAnimation()
  return (
    <NavLink
      to={to}
      onClick={play}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          isActive ? 'text-text' : 'text-muted hover:bg-white/5 hover:text-text'
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            key={played}
            className={cn(
              'size-[18px] transition-colors',
              played > 0 && `icon-${animation}`,
              isActive ? 'text-accent' : 'text-muted group-hover:text-text'
            )}
          />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {count !== undefined && count > 0 && <span className="text-xs tabular-nums text-muted">{count}</span>}
        </>
      )}
    </NavLink>
  )
}

/**
 * One highlight that glides to the active item (instead of each item lighting up on its own).
 * It measures the element marked aria-current="page" inside `container`.
 */
function useActiveIndicator(container: React.RefObject<HTMLElement | null>): { top: number; height: number; visible: boolean } {
  const location = useLocation()
  const [pos, setPos] = useState({ top: 0, height: 0, visible: false })
  useLayoutEffect(() => {
    const update = (): void => {
      const active = container.current?.querySelector<HTMLElement>('[aria-current="page"]')
      if (!active || !container.current) return setPos((p) => ({ ...p, visible: false }))
      const c = container.current.getBoundingClientRect()
      const a = active.getBoundingClientRect()
      setPos({ top: a.top - c.top, height: a.height, visible: true })
    }
    update()
    // The nav scrolls when there are many collections.
    const nav = container.current?.querySelector('nav')
    nav?.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    if (container.current) observer.observe(container.current)
    return () => {
      observer.disconnect()
      nav?.removeEventListener('scroll', update)
    }
  }, [location.pathname, container])
  return pos
}

function Indicator({ top, height, visible }: { top: number; height: number; visible: boolean }): React.JSX.Element {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-3 rounded-lg bg-white/8 transition-[transform,height,opacity] duration-500 ease-[cubic-bezier(0.3,0.8,0.2,1)]"
      style={{ transform: `translateY(${top}px)`, height, opacity: visible ? 1 : 0, top: 0 }}
    >
      <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_10px_var(--color-accent)]" />
    </div>
  )
}

/** Below Settings: your avatar and name when signed in, otherwise a sign-in prompt. */
function AccountItem(): React.JSX.Element {
  const account = useAccount()
  const [played, play] = useClickAnimation()
  return (
    <NavLink
      to="/account"
      onClick={play}
      className={({ isActive }) =>
        cn('group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors', isActive ? 'text-text' : 'text-muted hover:bg-white/5 hover:text-text')
      }
    >
      {account?.signedIn && account.username ? (
        <>
          <Avatar key={played} name={account.username} size="sm" status="online" className={cn(played > 0 && 'icon-bounce')} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-text">{account.username}</span>
            <span className="block text-[11px] text-muted">Account</span>
          </span>
        </>
      ) : (
        <>
          <UserCircle2 key={played} className={cn('size-[18px]', played > 0 && 'icon-bounce')} />
          <span className="flex-1">Sign in</span>
        </>
      )}
    </NavLink>
  )
}

export function Sidebar(): React.JSX.Element {
  const sidebarRef = useRef<HTMLElement>(null)
  const indicator = useActiveIndicator(sidebarRef)
  const { games, scan, addManually, sessions, metadata } = useLibrary()
  const playing = games.filter((g) => sessions[g.id])
  const [addPlayed, playAdd] = useClickAnimation()
  const visible = games.filter((g) => !g.hidden)
  const done = scan.progress.filter((p) => p.status !== 'pending' && p.status !== 'scanning').length
  const collections = useCollections()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  return (
    <aside ref={sidebarRef} className="relative z-10 flex w-60 shrink-0 flex-col border-r border-white/5 bg-black/25 backdrop-blur-xl">
      <Indicator {...indicator} />
      <div className="flex h-16 items-center gap-2.5 px-5 [-webkit-app-region:drag]">
        <div className="vanity-logo flex size-8 items-center justify-center rounded-lg">
          <Gamepad2 className="size-[18px] text-white" />
        </div>
        <span className="flex-1 text-lg font-bold tracking-tight">Vanity</span>
        <NavLink
          to="/big"
          title="Big Picture mode: full screen, for the couch"
          aria-label="Big Picture mode"
          className="rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-text [-webkit-app-region:no-drag]"
        >
          <Tv className="size-[18px]" />
        </NavLink>
      </div>

      <LevelBadge />

      <button
        onClick={openCommandPalette}
        className="mx-3 mb-2 flex items-center gap-2.5 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-muted transition hover:border-white/15 hover:text-text"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded border border-white/10 bg-black/30 px-1.5 py-px font-sans text-[10px] tracking-wide">Ctrl K</kbd>
      </button>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pt-1 [scrollbar-width:thin]">
        <NavItem to="/library" icon={LayoutGrid} label="Library" count={visible.length} animation="bounce" />
        <NavItem to="/trending" icon={Flame} label="Trending" animation="flame" />
        <NavItem to="/store" icon={ShoppingBag} label="Steam Store" animation="swing" />
        <NavItem to="/friends" icon={Users} label="Friends" animation="wave" />
        <NavItem to="/recent" icon={Clock} label="Recently Played" animation="rewind" />
        <NavItem to="/favorites" icon={Star} label="Favorites" count={visible.filter((g) => g.favorite).length} animation="star" />
        <NavItem to="/stats" icon={BarChart3} label="Stats" animation="bounce" />

        <div className="flex items-center justify-between px-3 pb-1 pt-5">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted/80">Collections</span>
          <button onClick={() => setCreating(true)} title="New collection" aria-label="New collection" className="rounded p-0.5 text-muted transition hover:bg-white/10 hover:text-text">
            <Plus className="size-3.5" />
          </button>
        </div>
        {collections.length === 0 ? (
          <button onClick={() => setCreating(true)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-muted transition hover:bg-white/5 hover:text-text">
            Group games your way: make a collection, then right-click games to add them.
          </button>
        ) : (
          collections.map((c) => (
            <NavItem key={c.id} to={`/collection/${c.id}`} icon={Layers} label={c.name} count={visible.filter((g) => g.collections.includes(c.id)).length} animation="bounce" />
          ))
        )}
      </nav>

      <div className="space-y-1 px-3 pb-4 pt-2">
        {playing.map((g) => (
          <NavLink
            key={g.id}
            to={`/game/${g.id}`}
            className="mb-2 flex items-center gap-3 rounded-lg bg-emerald-500/10 px-3 py-2.5 text-xs ring-1 ring-emerald-500/20 transition hover:bg-emerald-500/15"
          >
            <span className="relative flex size-2.5 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/70" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
            </span>
            <span className="min-w-0">
              <span className="block text-muted">{sessions[g.id] === 'running' ? 'Now playing' : 'Launching'}</span>
              <span className="block truncate text-sm font-medium text-text">{g.name}</span>
            </span>
          </NavLink>
        ))}
        {scan.running && (
          <NavLink to="/settings" className="mb-2 block rounded-lg bg-white/5 px-3 py-2.5 text-xs text-muted">
            <div className="mb-2 flex items-center gap-2">
              <span className="size-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              Scanning for games…
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${scan.progress.length ? (done / scan.progress.length) * 100 : 5}%` }}
              />
            </div>
          </NavLink>
        )}
        {metadata.running && !scan.running && metadata.total > 0 && (
          <div className="mb-2 rounded-lg bg-white/5 px-3 py-2.5 text-xs text-muted">
            <div className="mb-2 flex items-center justify-between">
              <span>Fetching artwork…</span>
              <span className="tabular-nums">
                {Math.min(metadata.done, metadata.total)}/{metadata.total}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-accent/80 transition-[width] duration-500" style={{ width: `${(metadata.done / metadata.total) * 100}%` }} />
            </div>
          </div>
        )}
        <button
          onClick={() => {
            playAdd()
            addManually()
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-white/5 hover:text-text"
        >
          <Plus key={addPlayed} className={cn('size-[18px]', addPlayed > 0 && 'icon-plus')} />
          Add a game
        </button>
        <NavItem to="/settings" icon={Settings} label="Settings" animation="gear" />
        <AccountItem />
      </div>
      {creating && (
        <NameDialog
          title="New collection"
          confirm="Create"
          onClose={() => setCreating(false)}
          onSubmit={async (name) => {
            const c = await createCollection(name)
            navigate(`/collection/${c.id}`)
          }}
        />
      )}
    </aside>
  )
}
