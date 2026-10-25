import { memo } from 'react'
import { Play, Star } from 'lucide-react'
import { PLAY_STATUS_LABELS, type Game, type SessionState } from '@shared/types'
import { cn } from '@/lib/cn'
import { formatCompact, formatPlaytime, formatRelativeDate } from '@/lib/format'
import { mediaUrl, nameHue } from '@/lib/media'
import { STATUS_TONE } from '@/lib/status'
import { SourceBadge } from './SourceBadge'

/** Columns shared by the list header and rows. */
export const ROW_GRID = 'grid grid-cols-[3rem_minmax(0,1fr)_7.5rem_5.5rem_7rem_7.5rem_2.5rem] items-center gap-4'

function Thumb({ game }: { game: Game }): React.JSX.Element {
  const cover = mediaUrl(game.coverPath)
  const hue = nameHue(game.name)
  return (
    <span className="relative block aspect-[3/4] w-12 overflow-hidden rounded-md ring-1 ring-white/10" style={{ background: `linear-gradient(160deg, hsl(${hue} 40% 24%), hsl(${(hue + 40) % 360} 45% 10%))` }}>
      {cover ? (
        <img src={cover} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center text-lg font-black text-white/40">{game.name.trim().charAt(0).toUpperCase()}</span>
      )}
    </span>
  )
}

/** One game in the compact list layout. Click opens it, right-click shows the menu. */
export const GameRow = memo(function GameRow({
  game,
  index,
  session,
  players,
  onOpen,
  onPlay,
  onMenu
}: {
  game: Game
  index: number
  session?: Exclude<SessionState, 'stopped'>
  players?: number
  onOpen: (g: Game) => void
  onPlay: (g: Game) => void
  onMenu: (e: React.MouseEvent, g: Game) => void
}): React.JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={game.name}
      onClick={() => onOpen(game)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(game)}
      onContextMenu={(e) => onMenu(e, game)}
      style={{ '--i': Math.min(index, 30) } as React.CSSProperties}
      className={cn(
        ROW_GRID,
        'animate-card-in group cursor-pointer rounded-xl px-3 py-2 outline-none transition hover:bg-white/[0.04] focus-visible:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-accent',
        (game.hidden || game.missing) && !session && 'opacity-50'
      )}
    >
      <Thumb game={game} />
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{game.name}</span>
          {game.favorite && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}
          {session && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
              {session === 'running' ? 'Playing' : 'Launching'}
            </span>
          )}
        </span>
        <span className="mt-1 flex items-center gap-2 text-xs text-muted">
          <SourceBadge source={game.source} />
          <span className="truncate">{[game.developer, game.releaseDate?.slice(0, 4), game.genres[0]].filter(Boolean).join(' · ')}</span>
          {players !== undefined && players > 0 && <span className="shrink-0 text-emerald-300/80">· {formatCompact(players)} playing</span>}
        </span>
      </span>
      <span>
        {game.playStatus && (
          <span className={cn('rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-semibold ring-1', STATUS_TONE[game.playStatus])}>{PLAY_STATUS_LABELS[game.playStatus]}</span>
        )}
      </span>
      <span className="flex" aria-label={game.userRating ? `${game.userRating} of 5 stars` : 'Not rated'}>
        {game.userRating
          ? Array.from({ length: 5 }, (_, i) => <Star key={i} className={cn('size-3', i < game.userRating! ? 'fill-amber-400 text-amber-400' : 'text-white/15')} />)
          : null}
      </span>
      <span className="text-right text-sm tabular-nums text-text/80">{game.playtimeSeconds ? formatPlaytime(game.playtimeSeconds) : <span className="text-muted">–</span>}</span>
      <span className="text-right text-sm text-muted">{game.lastPlayedAt ? formatRelativeDate(game.lastPlayedAt) : '–'}</span>
      <button
        data-gamepad-play
        tabIndex={-1}
        aria-label={`Play ${game.name}`}
        title="Play"
        onClick={(e) => {
          e.stopPropagation()
          onPlay(game)
        }}
        className="flex size-9 items-center justify-center rounded-full bg-accent text-white opacity-0 shadow-lg transition hover:scale-110 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <Play className="ml-0.5 size-4 fill-current" />
      </button>
    </div>
  )
})
