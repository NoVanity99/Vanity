import { useEffect, useRef, useState } from 'react'
import type { Game } from '@shared/types'
import { cn } from '@/lib/cn'
import { mediaUrl, nameHue } from '@/lib/media'

/** Generated art (gradient + title) shown until, or instead of, a real cover. */
function Placeholder({ game, showTitle }: { game: Game; showTitle: boolean }): React.JSX.Element {
  const hue = nameHue(game.name)
  return (
    <div
      className="absolute inset-0 flex items-end overflow-hidden p-4"
      style={{
        background: `radial-gradient(120% 80% at 20% 0%, hsl(${hue} 55% 32%) 0%, transparent 60%),
                     linear-gradient(160deg, hsl(${hue} 40% 18%) 0%, hsl(${(hue + 40) % 360} 45% 9%) 100%)`
      }}
    >
      <span aria-hidden className="absolute -right-3 -top-6 select-none text-[9rem] font-black leading-none text-white/[0.06]">
        {game.name.trim().charAt(0).toUpperCase()}
      </span>
      {showTitle && <span className="relative line-clamp-3 text-lg font-bold leading-tight text-white/90 drop-shadow">{game.name}</span>}
    </div>
  )
}

/**
 * The game's cover. While it loads, a shimmer runs over the placeholder;
 * the image then fades in. Without a cover, the placeholder stays.
 */
export function CoverArt({ game, className }: { game: Game; className?: string }): React.JSX.Element {
  // Owned Steam games use Steam's own cover. Newer games don't have one at the usual address:
  // their wide store image is tried next, before falling back to the name tile.
  const [fallback, setFallback] = useState(false)
  const steamApp = /\/steam\/apps\/(\d+)\/library_600x900\.jpg$/.exec(game.coverPath ?? '')?.[1]
  const src = fallback && steamApp ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${steamApp}/header.jpg` : mediaUrl(game.coverPath)
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  useEffect(() => setFallback(false), [game.coverPath])
  const img = useRef<HTMLImageElement>(null)

  useEffect(() => {
    // Cached images can finish before React attaches onLoad.
    setState(img.current?.complete && img.current.naturalWidth ? 'loaded' : 'loading')
  }, [src])

  const hasImage = !!src && state !== 'failed'
  // No cover yet (common for phone games): show the game's own icon instead of a bare placeholder.
  const icon = hasImage ? null : mediaUrl(game.iconPath)

  return (
    <div className={cn('relative size-full', className)}>
      <Placeholder game={game} showTitle={!icon && (!hasImage || state === 'loading')} />
      {icon && (
        <>
          <img src={icon} alt="" draggable={false} className="absolute inset-0 size-full scale-150 object-cover opacity-50 blur-2xl" />
          <div className="absolute inset-0 flex items-center justify-center">
            <img src={icon} alt="" draggable={false} loading="lazy" className="w-[58%] rounded-[22%] shadow-2xl shadow-black/60" />
          </div>
        </>
      )}
      {hasImage && state === 'loading' && <div className="shimmer absolute inset-0" />}
      {hasImage && (
        <img
          ref={img}
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => setState('loaded')}
          onError={() => (steamApp && !fallback ? setFallback(true) : setState('failed'))}
          className={cn(
            'absolute inset-0 size-full object-cover transition-[opacity,transform] duration-500 ease-out',
            state === 'loaded' ? 'opacity-100' : 'scale-[1.02] opacity-0'
          )}
        />
      )}
    </div>
  )
}
