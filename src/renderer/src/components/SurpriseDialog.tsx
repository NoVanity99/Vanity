import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dices, Play } from 'lucide-react'
import type { Game } from '@shared/types'
import { cn } from '@/lib/cn'
import { formatPlaytime, formatRelativeDate } from '@/lib/format'
import { useLibrary } from '@/state/library'
import { pickSurprise } from '@/lib/surprise'
import { Button, Dialog } from './Dialog'
import { CoverArt } from './CoverArt'

/** A slot-machine roll through your covers that lands on something to play. */
export function SurpriseDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { games, launch } = useLibrary()
  const navigate = useNavigate()
  const [shown, setShown] = useState<Game | null>(null)
  const [rolling, setRolling] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const roll = useCallback(() => {
    timers.current.forEach(clearTimeout)
    const pool = games.filter((g) => !g.hidden && !g.missing)
    const winner = pickSurprise(pool)
    if (!winner) return
    setRolling(true)
    // Flicker through random covers, slowing down like a reel, then land on the winner.
    let t = 0
    for (let i = 0; i < 18; i++) {
      t += 45 + i * i * 2.2
      timers.current.push(setTimeout(() => setShown(pool[Math.floor(Math.random() * pool.length)]), t))
    }
    timers.current.push(
      setTimeout(() => {
        setShown(winner)
        setRolling(false)
      }, t + 220)
    )
  }, [games])

  useEffect(() => {
    roll()
    return () => timers.current.forEach(clearTimeout)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog
      title="Surprise me"
      description="Can't decide? Let Vanity pick. Games you haven't touched in a while come up more often."
      onClose={onClose}
      footer={
        <>
          <Button className="mr-auto" onClick={roll} disabled={rolling}>
            <Dices className={cn('size-4', rolling && 'animate-spin')} /> Roll again
          </Button>
          <Button
            onClick={() => {
              if (shown) navigate(`/game/${shown.id}`)
              onClose()
            }}
            disabled={rolling || !shown}
          >
            Open
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (shown) void launch(shown.id)
              onClose()
            }}
            disabled={rolling || !shown}
          >
            <Play className="size-4 fill-current" /> Play
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 p-6">
        {shown ? (
          <>
            <div
              key={rolling ? shown.id : `final-${shown.id}`}
              className={cn(
                'aspect-[2/3] w-44 overflow-hidden rounded-xl shadow-2xl',
                rolling
                  ? 'scale-95 opacity-80 shadow-black/60 ring-1 ring-white/10 blur-[1px]'
                  : 'animate-pop-in shadow-[0_0_40px_-8px_var(--color-accent)] ring-2 ring-accent'
              )}
            >
              <CoverArt game={shown} />
            </div>
            <div className={cn('text-center transition-opacity', rolling ? 'opacity-40' : 'opacity-100')}>
              <p className="text-lg font-semibold">{shown.name}</p>
              <p className="text-sm text-muted">
                {shown.lastPlayedAt ? `Last played ${formatRelativeDate(shown.lastPlayedAt).toLowerCase()}` : 'Never played'}
                {shown.playtimeSeconds > 0 && ` · ${formatPlaytime(shown.playtimeSeconds)}`}
              </p>
            </div>
          </>
        ) : (
          <p className="py-16 text-sm text-muted">Add some games first.</p>
        )}
      </div>
    </Dialog>
  )
}
