import { cn } from '@/lib/cn'
import { nameHue } from '@/lib/media'

type Status = 'playing' | 'online' | 'offline' | undefined

/** Initials on a colour picked from the name, with an optional status dot. */
export function Avatar({ name, size = 'md', status, className }: { name: string; size?: 'sm' | 'md' | 'lg' | 'xl'; status?: Status; className?: string }): React.JSX.Element {
  const hue = nameHue(name)
  const initials = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
  const dims = { sm: 'size-7 text-[10px]', md: 'size-10 text-sm', lg: 'size-14 text-lg', xl: 'size-20 text-2xl' }[size]
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn('flex items-center justify-center rounded-full font-bold text-white ring-2 ring-bg', dims)}
        style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 50) % 360} 70% 38%))` }}
      >
        {initials}
      </span>
      {status && (
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-surface',
            size === 'sm' ? 'size-2.5' : 'size-3.5',
            status === 'playing' ? 'bg-accent' : status === 'online' ? 'bg-emerald-400' : 'bg-muted/60'
          )}
        />
      )}
    </span>
  )
}
