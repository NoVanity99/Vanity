import { memo } from 'react'
import { Play, Star } from 'lucide-react'
import type { Game, SessionState } from '@shared/types'
import { cn } from '@/lib/cn'
import { formatCompact } from '@/lib/format'
import { useTilt } from '@/hooks/useTilt'
import { CoverArt } from './CoverArt'
import { SourceBadge } from './SourceBadge'

interface Props {
  game: Game
  /** Position in the grid, for the cascade-in animation. */
  index: number
  session?: Exclude<SessionState, 'stopped'>
  /** Current Steam players, shown on hover. */
  players?: number
  onOpen: (game: Game) => void
  onPlay: (game: Game) => void
  onMenu: (e: React.MouseEvent, game: Game) => void
}

export const GameCard = memo(function GameCard({ game, index, session, players, onOpen, onPlay, onMenu }: Props): React.JSX.Element {
  const dimmed = (game.missing || game.hidden) && !session
  const tilt = useTilt<HTMLDivElement>()

  return (
    // A div, not a button: it contains the Play button, and buttons can't nest.
    <div
      role="button"
      tabIndex={0}
      aria-label={game.name}
      title={game.name}
      className="animate-card-in group cursor-pointer text-left outline-none"
      style={{ '--i': Math.min(index, 24) } as React.CSSProperties}
      onClick={() => onOpen(game)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(game)
      }}
      onContextMenu={(e) => onMenu(e, game)}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
    >
      <div ref={tilt.ref} className="tilt">
      <div
        className={cn(
          'relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-2 shadow-lg shadow-black/40 ring-1 ring-white/5',
          'transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]',
          'group-hover:-translate-y-1.5 group-hover:scale-[1.03] group-hover:shadow-2xl group-hover:shadow-black/70 group-hover:ring-white/25',
          'group-focus-visible:ring-2 group-focus-visible:ring-accent group-active:scale-[1.01]',
          dimmed && 'opacity-50 grayscale'
        )}
      >
        <CoverArt game={game} className="transition-transform duration-700 ease-out group-hover:scale-[1.06]" />

        <div className="tilt-glare pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        {/* Light sweep across the cover on hover. */}
        <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent opacity-0 transition duration-700 ease-out group-hover:translate-x-full group-hover:opacity-100" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2">
          <SourceBadge source={game.source} className="bg-black/55 opacity-0 backdrop-blur transition duration-300 group-hover:opacity-100" />
          {game.favorite && <Star className="size-4 fill-amber-400 text-amber-400 drop-shadow" />}
        </div>

        {session ? (
          <span className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-2 rounded-md bg-emerald-600/90 px-2 py-1.5 text-[11px] font-semibold text-white backdrop-blur">
            <span className="size-1.5 animate-pulse rounded-full bg-white" />
            {session === 'running' ? 'Playing' : 'Launching…'}
          </span>
        ) : (
          <>
            {game.missing && (
              <span className="absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-2 py-1 text-center text-[11px] font-medium text-accent backdrop-blur transition group-hover:opacity-0">
                Not found
              </span>
            )}
            {players !== undefined && players > 0 && (
              <span className="absolute bottom-4 left-3 flex translate-y-2 items-center gap-1.5 rounded-full bg-black/65 px-2 py-1 text-[11px] font-semibold text-white opacity-0 backdrop-blur transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgb(52_211_153)]" />
                {formatCompact(players)} playing
              </span>
            )}
            <button
              data-gamepad-play
              tabIndex={-1}
              aria-label={`Play ${game.name}`}
              title="Play"
              onClick={(e) => {
                e.stopPropagation()
                onPlay(game)
              }}
              className="absolute bottom-3 right-3 flex size-11 translate-y-3 items-center justify-center rounded-full bg-accent text-white opacity-0 shadow-lg shadow-black/50 transition duration-300 ease-out hover:scale-110 hover:brightness-110 focus-visible:translate-y-0 focus-visible:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
            >
              <Play className="ml-0.5 size-5 fill-current" />
            </button>
          </>
        )}
      </div>
      </div>
      <p className="mt-2.5 truncate text-sm font-medium text-text/85 transition-colors group-hover:text-text">{game.name}</p>
    </div>
  )
})
