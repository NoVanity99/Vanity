import { memo } from 'react'
import { Star } from 'lucide-react'
import type { Game } from '@shared/types'
import { cn } from '@/lib/cn'
import { CoverArt } from './CoverArt'
import { SourceBadge } from './SourceBadge'

interface Props {
  game: Game
  playing?: boolean
  onOpen: (game: Game) => void
  onMenu: (e: React.MouseEvent, game: Game) => void
}

export const GameCard = memo(function GameCard({ game, playing, onOpen, onMenu }: Props): React.JSX.Element {
  return (
    <button
      className="group text-left outline-none"
      onClick={() => onOpen(game)}
      onContextMenu={(e) => onMenu(e, game)}
      title={game.name}
    >
      <div
        className={cn(
          'relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-2 shadow-lg shadow-black/40 ring-1 ring-white/5',
          'transition duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-2xl group-hover:shadow-black/60 group-hover:ring-white/25',
          'group-focus-visible:ring-2 group-focus-visible:ring-accent',
          (game.missing || game.hidden) && 'opacity-50 grayscale'
        )}
      >
        <CoverArt game={game} className="transition duration-500 ease-out group-hover:scale-105" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2">
          <SourceBadge source={game.source} className="bg-black/55 opacity-0 backdrop-blur transition group-hover:opacity-100" />
          {game.favorite && <Star className="size-4 fill-amber-400 text-amber-400 drop-shadow" />}
        </div>
        {playing && (
          <span className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-2 rounded-md bg-emerald-600/90 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur">
            <span className="size-1.5 animate-pulse rounded-full bg-white" /> Playing
          </span>
        )}
        {game.missing && !playing && (
          <span className="absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-2 py-1 text-center text-[11px] font-medium text-accent backdrop-blur">
            Not found
          </span>
        )}
      </div>
      <p className="mt-2.5 truncate text-sm font-medium text-text/90 transition group-hover:text-text">{game.name}</p>
    </button>
  )
})
