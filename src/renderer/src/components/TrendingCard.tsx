import { memo, useState } from 'react'
import { Eye, Flame, Users } from 'lucide-react'
import type { PopularityStat, TrendingGame } from '@shared/types'
import { cn } from '@/lib/cn'
import { formatCompact } from '@/lib/format'
import { nameHue } from '@/lib/media'
import { StoreIcon } from './StoreIcon'

/** Gold, silver and bronze for the top three; a neutral badge for the rest. */
const RANK_STYLE: Record<number, string> = {
  1: 'bg-gradient-to-br from-amber-300 to-amber-600 text-black shadow-amber-500/40',
  2: 'bg-gradient-to-br from-slate-100 to-slate-400 text-black shadow-slate-300/30',
  3: 'bg-gradient-to-br from-orange-300 to-orange-700 text-black shadow-orange-500/30'
}

export function PopularityLabel({ stat }: { stat: PopularityStat }): React.JSX.Element {
  const [Icon, text] =
    stat.kind === 'players' && stat.value !== null
      ? [Users, `${formatCompact(stat.value)} playing`]
      : stat.kind === 'viewers' && stat.value !== null
        ? [Eye, `${formatCompact(stat.value)} watching`]
        : [Flame, 'Trending on IGDB']
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <Icon className="size-3.5" />
      {text}
    </span>
  )
}

interface Props {
  game: TrendingGame
  index: number
  onSelect: (game: TrendingGame) => void
}

export const TrendingCard = memo(function TrendingCard({ game, index, onSelect }: Props): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const hue = nameHue(game.title)

  return (
    <button
      onClick={() => onSelect(game)}
      title={game.title}
      className="animate-card-in group text-left outline-none"
      style={{ '--i': Math.min(index, 24) } as React.CSSProperties}
    >
      <div
        className={cn(
          'relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-2 shadow-lg shadow-black/40 ring-1 ring-white/5',
          'transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]',
          'group-hover:-translate-y-1.5 group-hover:scale-[1.03] group-hover:shadow-2xl group-hover:shadow-black/70 group-hover:ring-white/25',
          'group-focus-visible:ring-2 group-focus-visible:ring-accent'
        )}
      >
        <div
          className="absolute inset-0 flex items-end p-4"
          style={{ background: `linear-gradient(160deg, hsl(${hue} 40% 20%), hsl(${(hue + 40) % 360} 45% 9%))` }}
        >
          {(!game.coverUrl || failed || !loaded) && <span className="line-clamp-3 text-lg font-bold leading-tight text-white/90">{game.title}</span>}
        </div>
        {game.coverUrl && !failed && (
          <>
            {!loaded && <div className="shimmer absolute inset-0" />}
            <img
              src={game.coverUrl}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
              className={cn(
                'absolute inset-0 size-full object-cover transition-[opacity,transform] duration-700 ease-out group-hover:scale-[1.06]',
                loaded ? 'opacity-100' : 'opacity-0'
              )}
            />
          </>
        )}
        <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent opacity-0 transition duration-700 ease-out group-hover:translate-x-full group-hover:opacity-100" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/60 to-transparent" />

        <span
          className={cn(
            'absolute left-2.5 top-2.5 flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-black tabular-nums shadow-lg',
            RANK_STYLE[game.rank] ?? 'bg-black/60 text-white ring-1 ring-white/15 backdrop-blur'
          )}
        >
          {game.rank}
        </span>
      </div>

      <p className="mt-2.5 truncate text-sm font-semibold text-text/90 transition-colors group-hover:text-text">{game.title}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <PopularityLabel stat={game.popularityStat} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {game.stores.map((s) => (
          <StoreIcon key={s.launcher} launcher={s.launcher} />
        ))}
      </div>
    </button>
  )
})
