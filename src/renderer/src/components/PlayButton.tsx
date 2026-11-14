import { Download, Play } from 'lucide-react'
import type { Game } from '@shared/types'
import { cn } from '@/lib/cn'
import { useLibrary } from '@/state/library'
import { StopBubble } from './StopBubble'

/** The big Play button. Shows "Starting…" until the game is seen running, then "Playing". A red bubble beside it cancels the start, or closes the game. */
export function PlayButton({ game }: { game: Game }): React.JSX.Element {
  const { sessions, launch, install } = useLibrary()
  const state = sessions[game.id]

  // Owned but not installed: the button installs instead.
  if (!game.installed && !state) {
    return (
      <span className="flex flex-col gap-1.5">
        <button
          data-gamepad-play-main
          data-install
          onClick={() => install(game.id)}
          className="flex h-14 min-w-44 items-center justify-center gap-3 rounded-xl bg-white px-10 text-lg font-bold text-black shadow-xl shadow-black/30 transition hover:-translate-y-0.5 hover:shadow-2xl active:scale-[0.98]"
        >
          <Download className="size-5" /> Install
        </button>
        {game.source === 'steam' && <span className="text-xs text-white/70">Steam games install through Steam.</span>}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-3">
    <button
      data-gamepad-play-main
      onClick={() => launch(game.id)}
      disabled={state !== undefined}
      className={cn(
        'group/play relative flex h-14 min-w-44 items-center justify-center gap-3 overflow-hidden rounded-xl px-10 text-lg font-bold text-white shadow-xl transition active:scale-[0.98]',
        state === 'running'
          ? 'cursor-default bg-emerald-600 shadow-emerald-600/25'
          : 'bg-accent shadow-accent/25 hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-accent/40 hover:brightness-110 disabled:cursor-wait'
      )}
    >
      {state === 'launching' ? (
        <>
          <span className="size-5 animate-spin rounded-full border-[3px] border-white border-t-transparent" />
          Starting…
        </>
      ) : state === 'running' ? (
        <>
          <span className="relative flex size-3">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70" />
            <span className="relative inline-flex size-3 rounded-full bg-white" />
          </span>
          Playing
        </>
      ) : (
        <>
          {/* Sheen that sweeps across on hover. */}
          <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition duration-700 ease-out group-hover/play:translate-x-full" />
          <Play className="size-5 fill-current" /> Play
        </>
      )}
    </button>
    <StopBubble gameId={game.id} name={game.name} size="lg" />
    </span>
  )
}
