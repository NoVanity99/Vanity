import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Award, Sparkles, X } from 'lucide-react'
import type { Game, GamePlayStats } from '@shared/types'
import { formatPlaytime } from '@/lib/format'
import { mediaUrl } from '@/lib/media'
import { milestones } from '@/lib/playtime'
import { levelFor, totalXp } from '@/lib/xp'
import { useLibrary } from '@/state/library'

const SHOW_MS = 14_000
/** Sessions shorter than this don't get a recap. */
const MIN_SECONDS = 60

interface Recap {
  game: Game
  seconds: number
  total: number
  xp: number
  levelUp: number | null
  unlocked: string[]
}

const unlockedIds = (game: Game, stats: GamePlayStats): Set<string> =>
  new Set(milestones({ playtimeSeconds: game.playtimeSeconds, playStatus: game.playStatus, firstPlayedAt: stats.firstPlayedAt, sessions: stats.history }).filter((m) => m.unlocked).map((m) => m.id))

/** After you close a game: how long you played, the XP you earned, and anything you unlocked. */
export function SessionRecap(): React.JSX.Element | null {
  const { games } = useLibrary()
  const navigate = useNavigate()
  const gamesRef = useRef(games)
  gamesRef.current = games
  const before = useRef(new Map<number, { xp: number; unlocked: Set<string> }>())
  const [recap, setRecap] = useState<Recap | null>(null)

  useEffect(
    () =>
      window.vanity.sessions.onChange(({ gameId, state }) => {
        if (state === 'running' && !before.current.has(gameId)) {
          const game = gamesRef.current.find((g) => g.id === gameId)
          if (!game) return
          const xp = totalXp(gamesRef.current)
          window.vanity.games.playStats(gameId).then((s) => before.current.set(gameId, { xp, unlocked: unlockedIds(game, s) }), () => {})
        }
        if (state !== 'stopped') return
        const start = before.current.get(gameId)
        before.current.delete(gameId)
        if (!start) return
        Promise.all([window.vanity.games.get(gameId), window.vanity.games.playStats(gameId)]).then(([game, stats]) => {
          const last = stats.history[0]
          if (!game || !last || last.seconds < MIN_SECONDS) return
          const others = gamesRef.current.filter((g) => g.id !== gameId)
          const xpAfter = totalXp([...others, game])
          const unlocked = milestones({ playtimeSeconds: game.playtimeSeconds, playStatus: game.playStatus, firstPlayedAt: stats.firstPlayedAt, sessions: stats.history }).filter(
            (m) => m.unlocked && !start.unlocked.has(m.id)
          )
          const levelBefore = levelFor(start.xp).level
          const levelAfter = levelFor(xpAfter).level
          setRecap({
            game,
            seconds: last.seconds,
            total: game.playtimeSeconds,
            xp: Math.max(0, xpAfter - start.xp),
            levelUp: levelAfter > levelBefore ? levelAfter : null,
            unlocked: unlocked.map((m) => m.title)
          })
        }, () => {})
      }),
    []
  )

  useEffect(() => {
    if (!recap) return
    const t = setTimeout(() => setRecap(null), SHOW_MS)
    return () => clearTimeout(t)
  }, [recap])

  if (!recap) return null
  const art = mediaUrl(recap.game.heroPath) ?? mediaUrl(recap.game.coverPath)
  return (
    <div className="animate-rise-in fixed bottom-6 left-64 z-40 w-[22rem] overflow-hidden rounded-2xl border border-white/10 bg-surface/95 shadow-2xl shadow-black/60 backdrop-blur-xl">
      <div className="relative h-24 overflow-hidden">
        {art && <img src={art} alt="" className="absolute inset-0 size-full scale-110 object-cover opacity-60 blur-[2px]" draggable={false} />}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />
        <button onClick={() => setRecap(null)} aria-label="Close" className="absolute right-2 top-2 rounded-full bg-black/40 p-1.5 text-white/80 hover:bg-black/60">
          <X className="size-3.5" />
        </button>
        <div className="absolute inset-x-4 bottom-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">Session complete</p>
          <p className="truncate text-lg font-bold">{recap.game.name}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 px-4 pb-3 pt-2 text-center">
        <div>
          <p className="font-display text-lg font-bold">{formatPlaytime(recap.seconds)}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted">This session</p>
        </div>
        <div>
          <p className="font-display text-lg font-bold">{formatPlaytime(recap.total)}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted">In total</p>
        </div>
        <div>
          <p className="font-display text-lg font-bold text-accent">+{recap.xp.toLocaleString()}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted">XP</p>
        </div>
      </div>
      {(recap.levelUp || recap.unlocked.length > 0) && (
        <div className="space-y-1.5 border-t border-white/5 px-4 py-3 text-sm">
          {recap.levelUp && (
            <p className="flex items-center gap-2 font-semibold">
              <Sparkles className="size-4 text-amber-300" /> Level up! You're now level {recap.levelUp}.
            </p>
          )}
          {recap.unlocked.map((t) => (
            <button key={t} onClick={() => navigate(`/game/${recap.game.id}`)} className="flex items-center gap-2 text-left hover:text-accent">
              <Award className="size-4 text-accent" /> Milestone unlocked: <b>{t}</b>
            </button>
          ))}
        </div>
      )}
      <div className="h-0.5 bg-white/5">
        <div className="h-full origin-left bg-accent" style={{ animation: `shrink ${SHOW_MS}ms linear forwards` }} />
      </div>
    </div>
  )
}
