import { cn } from '@/lib/cn'
import { nameHue } from '@/lib/media'

type Status = 'playing' | 'online' | 'offline' | undefined

/** The profile picture, or initials on a colour picked from the name. With an optional status dot. */
export function Avatar({
  name,
  src,
  frame,
  size = 'md',
  status,
  className
}: {
  name: string
  src?: string | null
  /** A frame id from src/shared/profileStyle.ts; 'none' or nothing for a plain picture. */
  frame?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  status?: Status
  className?: string
}): React.JSX.Element {
  const hue = nameHue(name)
  const initials = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
  const dims = { sm: 'size-7 text-[10px]', md: 'size-10 text-sm', lg: 'size-14 text-lg', xl: 'size-20 text-2xl' }[size]
  const picture = (
    <span
      className={cn('flex items-center justify-center overflow-hidden rounded-full font-bold text-white ring-2 ring-bg', dims)}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 50) % 360} 70% 38%))` }}
    >
      {/* Only pictures the app itself made (data: addresses) are shown, never a link to somewhere else. */}
      {src?.startsWith('data:image/') ? <img src={src} alt="" className="size-full object-cover" draggable={false} /> : initials}
    </span>
  )
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {frame && frame !== 'none' ? (
        <span className="avatar-frame" data-frame={frame} data-size={size}>
          {picture}
        </span>
      ) : (
        picture
      )}
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
