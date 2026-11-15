import { useEffect, useState } from 'react'
import { Power, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useLibrary } from '@/state/library'

/**
 * A small red round button for a game that is starting or running:
 * - starting: cancels the launch straight away;
 * - running: force-closes the game (like "End task" in Task Manager). It asks once first,
 *   because unsaved progress in the game is lost.
 * Renders nothing when the game is neither.
 */
export function StopBubble({ gameId, name, className, size = 'md' }: { gameId: number; name: string; className?: string; size?: 'sm' | 'md' | 'lg' }): React.JSX.Element | null {
  const { sessions, stop } = useLibrary()
  const state = sessions[gameId]
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  // The "are you sure" state lapses by itself.
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  useEffect(() => setArmed(false), [state])

  if (!state) return null
  const running = state === 'running'
  const dims = { sm: 'h-6 min-w-6 text-[10px]', md: 'h-8 min-w-8 text-xs', lg: 'h-14 min-w-14 text-sm' }[size]
  const icon = { sm: 'size-3', md: 'size-4', lg: 'size-6' }[size]
  const label = running ? (armed ? `Click again to close ${name}. Unsaved progress will be lost.` : `Close ${name} (ends the game, like End task)`) : `Cancel starting ${name}`

  return (
    <button
      type="button"
      data-stop-bubble
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation()
        e.preventDefault()
        if (running && !armed) return setArmed(true)
        setBusy(true)
        try {
          await stop(gameId)
        } finally {
          setBusy(false)
          setArmed(false)
        }
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        'pointer-events-auto flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-red-600 font-bold text-white shadow-lg shadow-black/50 ring-1 ring-white/20 transition hover:scale-110 hover:bg-red-500 active:scale-95 disabled:opacity-60',
        dims,
        armed && 'px-3 ring-2 ring-white/60',
        className
      )}
    >
      {running ? <Power className={icon} /> : <X className={icon} />}
      {armed && <span className="whitespace-nowrap">Close game?</span>}
    </button>
  )
}
