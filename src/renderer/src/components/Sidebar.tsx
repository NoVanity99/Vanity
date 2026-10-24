import { NavLink } from 'react-router-dom'
import { Clock, Gamepad2, LayoutGrid, Plus, Settings, Star, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useLibrary } from '@/state/library'

function NavItem({ to, icon: Icon, label, count }: { to: string; icon: LucideIcon; label: string; count?: number }): React.JSX.Element {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          isActive ? 'bg-white/8 text-text' : 'text-muted hover:bg-white/5 hover:text-text'
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-all duration-300',
              isActive ? 'opacity-100' : 'h-0 opacity-0'
            )}
          />
          <Icon className={cn('size-[18px] transition-colors', isActive ? 'text-accent' : 'text-muted group-hover:text-text')} />
          <span className="flex-1">{label}</span>
          {count !== undefined && count > 0 && <span className="text-xs tabular-nums text-muted">{count}</span>}
        </>
      )}
    </NavLink>
  )
}

export function Sidebar(): React.JSX.Element {
  const { games, scan, addManually } = useLibrary()
  const visible = games.filter((g) => !g.hidden)
  const done = scan.progress.filter((p) => p.status !== 'pending' && p.status !== 'scanning').length

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-white/5 bg-black/25">
      <div className="flex h-16 items-center gap-2.5 px-5 [-webkit-app-region:drag]">
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-rose-700 shadow-lg shadow-accent/20">
          <Gamepad2 className="size-[18px] text-white" />
        </div>
        <span className="text-lg font-bold tracking-tight">Vanity</span>
      </div>

      <nav className="space-y-1 px-3 pt-2">
        <NavItem to="/library" icon={LayoutGrid} label="Library" count={visible.length} />
        <NavItem to="/recent" icon={Clock} label="Recently Played" />
        <NavItem to="/favorites" icon={Star} label="Favorites" count={visible.filter((g) => g.favorite).length} />
      </nav>

      <div className="mt-auto space-y-1 px-3 pb-4">
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
        <button
          onClick={addManually}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-white/5 hover:text-text"
        >
          <Plus className="size-[18px]" />
          Add a game
        </button>
        <NavItem to="/settings" icon={Settings} label="Settings" />
      </div>
    </aside>
  )
}
