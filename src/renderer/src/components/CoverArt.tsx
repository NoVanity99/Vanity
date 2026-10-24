import { useState } from 'react'
import type { Game } from '@shared/types'
import { cn } from '@/lib/cn'
import { mediaUrl, nameHue } from '@/lib/media'

/** The game's cover, or a generated placeholder (gradient + title) when there is none yet. */
export function CoverArt({ game, className }: { game: Game; className?: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const src = mediaUrl(game.coverPath)

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn('size-full object-cover', className)}
      />
    )
  }

  const hue = nameHue(game.name)
  return (
    <div
      className={cn('relative flex size-full items-end overflow-hidden p-4', className)}
      style={{
        background: `radial-gradient(120% 80% at 20% 0%, hsl(${hue} 55% 32%) 0%, transparent 60%),
                     linear-gradient(160deg, hsl(${hue} 40% 18%) 0%, hsl(${(hue + 40) % 360} 45% 9%) 100%)`
      }}
    >
      <span
        aria-hidden
        className="absolute -right-3 -top-6 select-none text-[9rem] font-black leading-none text-white/[0.06]"
      >
        {game.name.trim().charAt(0).toUpperCase()}
      </span>
      <span className="relative line-clamp-3 text-lg font-bold leading-tight text-white/90 drop-shadow">{game.name}</span>
    </div>
  )
}
