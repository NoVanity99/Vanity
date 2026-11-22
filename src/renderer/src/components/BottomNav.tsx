import { NavLink } from 'react-router-dom'
import { Flame, LayoutGrid, Menu, MessagesSquare, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

const ITEMS: { to: string; icon: LucideIcon; label: string }[] = [
  { to: '/library', icon: LayoutGrid, label: 'Library' },
  { to: '/trending', icon: Flame, label: 'Trending' },
  { to: '/friends', icon: Users, label: 'Friends' },
  { to: '/channels', icon: MessagesSquare, label: 'Channels' }
]

/** Phone navigation: the main tabs along the bottom, with Menu opening everything else. */
export function BottomNav({ onMenu }: { onMenu: () => void }): React.JSX.Element {
  const item = 'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors'
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] border-t border-white/10 bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      {ITEMS.map(({ to, icon: Icon, label }) => (
        <NavLink key={to} to={to} className={({ isActive }) => cn(item, isActive ? 'text-accent' : 'text-muted')}>
          <Icon className="size-5" />
          {label}
        </NavLink>
      ))}
      <button onClick={onMenu} className={cn(item, 'text-muted')} aria-label="Menu">
        <Menu className="size-5" />
        Menu
      </button>
    </nav>
  )
}
