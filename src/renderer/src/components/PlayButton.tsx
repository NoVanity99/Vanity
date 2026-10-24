import { Play } from 'lucide-react'
import type { Game } from '@shared/types'
import { cn } from '@/lib/cn'
import { useLibrary } from '@/state/library'

/** The big Play button. Shows "Launching…" until the game is seen running, then "Playing". */
export function PlayButton({ game }: { game: Game }): React.JSX.Element {
  const { sessions, launch } = useLibrary()
  const state = sessions[game.id]

  return (
    <button
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
          Launching…
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
  )
}
