import { clampSidebarWidth, SIDEBAR_WIDTH, type InterfaceOptions, type NavItemId } from '@shared/interfaceOptions'
import { saveSettings, useInterface } from '@/state/settings'
import { UserName } from '@/components/UserName'
import { useDownloads } from '@/state/downloads'
import { useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Award, BarChart3, Download, Clock, Flame, Gamepad2, Layers, LayoutGrid, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, ShoppingBag, Star, Tv, UserCircle2, Users, type LucideIcon } from 'lucide-react'
import { createCollection, useCollections } from '@/state/collections'
import { openCommandPalette } from './CommandPalette'
import { NameDialog } from './CollectionsDialog'
import { LevelBadge } from './LevelBadge'
import { openAppPicker } from './AppPicker'
import { isAndroid, menuGesture } from '@/lib/platform'
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
interface IndicatorPos {
  top: number
  height: number
  visible: boolean
  /** How much of it is scrolled out of the list, above and below: that part isn't drawn. */
  clipTop: number
  clipBottom: number
  /** Following a scroll: it moves with the list at once instead of gliding after it. */
  instant: boolean
}

function useActiveIndicator(container: React.RefObject<HTMLElement | null>): IndicatorPos {
  const location = useLocation()
  const [pos, setPos] = useState<IndicatorPos>({ top: 0, height: 0, visible: false, clipTop: 0, clipBottom: 0, instant: false })
  useLayoutEffect(() => {
    const nav = container.current?.querySelector('nav') ?? null
    const update = (instant: boolean): void => {
      const active = container.current?.querySelector<HTMLElement>('[aria-current="page"]')
      if (!active || !container.current) return setPos((p) => ({ ...p, visible: false }))
      const c = container.current.getBoundingClientRect()
      const a = active.getBoundingClientRect()
      // The list scrolls (a small window, or many collections). The highlight belongs to the list,
      // so whatever part of the current page's entry has scrolled out of it is cut off, instead of
      // sliding over the search box and level above or the buttons below.
      let clipTop = 0
      let clipBottom = 0
      if (nav?.contains(active)) {
        const n = nav.getBoundingClientRect()
        clipTop = Math.min(a.height, Math.max(0, n.top - a.top))
        clipBottom = Math.min(a.height, Math.max(0, a.bottom - n.bottom))
      }
      setPos({ top: a.top - c.top, height: a.height, visible: clipTop + clipBottom < a.height, clipTop, clipBottom, instant })
    }
    update(false)
    const onScroll = (): void => update(true)
    // (An observer reports once as soon as it starts watching: that isn't a resize.)
    let watching = false
    const onResize = (): void => {
      if (watching) update(true)
    }
    nav?.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(onResize)
    if (container.current) observer.observe(container.current)
    if (nav) observer.observe(nav)
    const settle = requestAnimationFrame(() => requestAnimationFrame(() => (watching = true)))
    return () => {
      cancelAnimationFrame(settle)
      observer.disconnect()
      nav?.removeEventListener('scroll', onScroll)
    }
  }, [location.pathname, container])
  return pos
}

function Indicator({ top, height, visible, clipTop, clipBottom, instant }: IndicatorPos): React.JSX.Element {
  return (
    <div
      aria-hidden
      data-nav-indicator
      className={cn('pointer-events-none absolute inset-x-3 rounded-lg bg-white/8', !instant && 'transition-[transform,height,opacity] duration-500 ease-[cubic-bezier(0.3,0.8,0.2,1)]')}
      style={{ transform: `translateY(${top}px)`, height, opacity: visible ? 1 : 0, top: 0, clipPath: clipTop || clipBottom ? `inset(${clipTop}px -14px ${clipBottom}px -14px)` : undefined }}
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
        cn('group relative flex items-center gap-3 overflow-clip rounded-lg px-3 py-2 text-sm font-medium transition-colors [&>*]:relative', isActive ? 'text-text' : 'text-muted hover:bg-white/5 hover:text-text')
      }
    >
      {account?.signedIn && account.username ? (
        <>
          {/* Your profile banner, behind your name. */}
          <span aria-hidden className="profile-banner !absolute rounded-lg ring-1 ring-inset ring-white/10" data-banner={account.style.banner} data-sidebar-banner />
          <Avatar key={played} name={account.username} src={account.avatar} frame={account.style.frame} size="sm" status="online" className={cn(played > 0 && 'icon-bounce')} />
          <span className="min-w-0 flex-1">
            <UserName name={account.username} style={account.style} verified={account.verified} admin={account.admin} className="flex text-text" />
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

/** `open`/`onClose` only matter on phones, where the sidebar is a slide-out menu. */
export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }): React.JSX.Element {
  const sidebarRef = useRef<HTMLElement>(null)
  const indicator = useActiveIndicator(sidebarRef)
  const { games, scan, addManually, sessions, metadata } = useLibrary()
  const playing = games.filter((g) => sessions[g.id])
  const [addPlayed, playAdd] = useClickAnimation()
  const visible = games.filter((g) => !g.hidden)
  // Downloads still to finish, shown next to the Downloads entry.
  const queued = useDownloads().filter((d) => d.state !== 'done').length
  const done = scan.progress.filter((p) => p.status !== 'pending' && p.status !== 'scanning').length
  const collections = useCollections()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const ui = useInterface()
  const shows = (id: NavItemId): boolean => !ui.hiddenNav.includes(id)
  const count = (n: number | undefined): number | undefined => (ui.sidebarCounts ? n : undefined)

  // Width and collapse (computers only: on phones the sidebar is a slide-out menu).
  const setUi = (patch: Partial<InterfaceOptions>): void => void saveSettings({ interface: { ...ui, ...patch } }).catch(() => {})
  // While the edge is being dragged the width follows the mouse; it is saved when you let go.
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const width = dragWidth ?? ui.sidebarWidth
  const startResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const left = sidebarRef.current?.getBoundingClientRect().left ?? 0
    let latest = ui.sidebarWidth
    const move = (ev: PointerEvent): void => setDragWidth((latest = clampSidebarWidth(ev.clientX - left)))
    const up = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      setUi({ sidebarWidth: latest })
      // Keep showing the dragged width until the saved one arrives, so it doesn't jump back for a moment.
      setTimeout(() => setDragWidth(null), 150)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  return (
    <>
    {/* Phones: tap outside the menu to close it. */}
    <div aria-hidden onClick={onClose} className={cn('fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 md:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')} />
    {ui.sidebarCollapsed && (
      <button
        onClick={() => setUi({ sidebarCollapsed: false })}
        title="Show the sidebar"
        aria-label="Show the sidebar"
        data-sidebar-expand
        className="fixed left-2 top-1.5 z-30 flex size-7 items-center justify-center rounded-lg border border-white/10 bg-black/50 text-muted backdrop-blur transition hover:border-accent/60 hover:text-text max-md:hidden [-webkit-app-region:no-drag]"
      >
        <PanelLeftOpen className="size-4" />
      </button>
    )}
    <aside
      ref={sidebarRef}
      data-sidebar
      style={{ '--sidebar-w': `${width}px` } as React.CSSProperties}
      className={cn(
        'relative z-10 flex shrink-0 flex-col border-r border-white/5 bg-black/25 backdrop-blur-xl md:w-[var(--sidebar-w)]',
        ui.sidebarCollapsed && 'md:hidden',
        'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-72 max-md:bg-bg max-md:pb-[env(safe-area-inset-bottom)] max-md:pt-[env(safe-area-inset-top)] max-md:transition-transform max-md:duration-300',
        !open && 'max-md:-translate-x-full'
      )}
    >
      {/* Drag this edge to make the sidebar wider or narrower; double-click puts it back. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Sidebar width"
        aria-valuemin={SIDEBAR_WIDTH.min}
        aria-valuemax={SIDEBAR_WIDTH.max}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        data-sidebar-resize
        onPointerDown={startResize}
        onDoubleClick={() => setUi({ sidebarWidth: SIDEBAR_WIDTH.normal })}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            setUi({ sidebarWidth: clampSidebarWidth(ui.sidebarWidth + (e.key === 'ArrowRight' ? 16 : -16)) })
          }
        }}
        className={cn(
          'absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize outline-none transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-accent focus-visible:after:bg-accent max-md:hidden [-webkit-app-region:no-drag]',
          dragWidth !== null && 'after:bg-accent'
        )}
      />
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
          className="rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-text max-md:hidden [-webkit-app-region:no-drag]"
        >
          <Tv className="size-[18px]" />
        </NavLink>
        <button
          onClick={() => setUi({ sidebarCollapsed: true })}
          title="Hide the sidebar"
          aria-label="Hide the sidebar"
          data-sidebar-collapse
          className="rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-text max-md:hidden [-webkit-app-region:no-drag]"
        >
          <PanelLeftClose className="size-[18px]" />
        </button>
      </div>

      {ui.sidebarLevel && <LevelBadge />}

      {ui.sidebarSearch && (
      <button
        onClick={() => {
          onClose?.()
          openCommandPalette()
        }}
        className="mx-3 mb-2 flex items-center gap-2.5 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-muted transition hover:border-white/15 hover:text-text"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded border border-white/10 bg-black/30 px-1.5 py-px font-sans text-[10px] tracking-wide max-md:hidden">Ctrl K</kbd>
      </button>
      )}

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pt-1 [scrollbar-width:thin]">
        <NavItem to="/library" icon={LayoutGrid} label="Library" count={count(visible.length)} animation="bounce" />
        {shows('trending') && <NavItem to="/trending" icon={Flame} label="Trending" animation="flame" />}
        {!isAndroid() && shows('store') && <NavItem to="/store" icon={ShoppingBag} label="Steam Store" animation="swing" />}
        {shows('friends') && <NavItem to="/friends" icon={Users} label="Friends" animation="wave" />}
        {shows('recent') && <NavItem to="/recent" icon={Clock} label="Recently Played" animation="rewind" />}
        {shows('favorites') && <NavItem to="/favorites" icon={Star} label="Favorites" count={count(visible.filter((g) => g.favorite).length)} animation="star" />}
        {shows('stats') && <NavItem to="/stats" icon={BarChart3} label="Stats" animation="bounce" />}
        {shows('profile') && <NavItem to="/profile" icon={Award} label="Profile" animation="bounce" />}
        {/* Downloads in progress always show, even with the entry hidden. */}
        {!isAndroid() && (shows('downloads') || queued > 0) && <NavItem to="/downloads" icon={Download} label="Downloads" count={queued || undefined} animation="bounce" />}

        {ui.sidebarCollections && (
          <>
        <div className="flex items-center justify-between px-3 pb-1 pt-5">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted/80">Collections</span>
          <button onClick={() => setCreating(true)} title="New collection" aria-label="New collection" className="rounded p-0.5 text-muted transition hover:bg-white/10 hover:text-text">
            <Plus className="size-3.5" />
          </button>
        </div>
        {collections.length === 0 ? (
          <button onClick={() => setCreating(true)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-muted transition hover:bg-white/5 hover:text-text">
            Group games your way: make a collection, then {menuGesture().toLowerCase()} a game to add it.
          </button>
        ) : (
          collections.map((c) => (
            <NavItem key={c.id} to={`/collection/${c.id}`} icon={Layers} label={c.name} count={count(visible.filter((g) => g.collections.includes(c.id)).length)} animation="bounce" />
          ))
        )}
          </>
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
              <span className="block text-muted">{sessions[g.id] === 'running' ? 'Now playing' : 'Starting'}</span>
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
            onClose?.()
            // Android adds games from the list of installed apps; Windows from a file.
            if (isAndroid()) openAppPicker()
            else void addManually()
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
    </>
  )
}
