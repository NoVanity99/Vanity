import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Info, LogOut, Play, Star } from 'lucide-react'
import { PLAY_STATUS_LABELS, type Game } from '@shared/types'
import { useGamepadHandler } from '@/gamepad/GamepadLayer'
import { cn } from '@/lib/cn'
import { formatPlaytime, formatRelativeDate } from '@/lib/format'
import { mediaUrl, nameHue } from '@/lib/media'
import { STATUS_STYLES } from '@/lib/status'
import { levelFor, totalXp } from '@/lib/xp'
import { useCollections } from '@/state/collections'
import { useLibrary } from '@/state/library'

interface Row {
  id: string
  title: string
  games: Game[]
}

function Clock(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  return <span className="tabular-nums">{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
}

function Tile({ game, row, col, selected, running, onFocus, onPlay }: { game: Game; row: number; col: number; selected: boolean; running: boolean; onFocus: () => void; onPlay: () => void }): React.JSX.Element {
  const cover = mediaUrl(game.coverPath)
  const hue = nameHue(game.name)
  return (
    <button
      data-bp-row={row}
      data-bp-col={col}
      onFocus={onFocus}
      onMouseEnter={onFocus}
      onClick={onPlay}
      aria-label={`${game.name}. Press to play.`}
      className={cn(
        'relative aspect-[2/3] w-40 shrink-0 overflow-hidden rounded-xl shadow-xl shadow-black/50 outline-none transition duration-300 ease-out',
        selected ? 'z-10 scale-110 ring-4 ring-accent shadow-2xl shadow-accent/30' : 'opacity-75 ring-1 ring-white/10 hover:opacity-100'
      )}
      style={{ background: `linear-gradient(160deg, hsl(${hue} 45% 26%), hsl(${(hue + 40) % 360} 45% 10%))` }}
    >
      {cover ? (
        <img src={cover} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-end p-3 text-left text-base font-bold leading-tight">{game.name}</span>
      )}
      {running && <span className="absolute inset-x-2 bottom-2 rounded-md bg-emerald-600/90 py-1 text-center text-[11px] font-semibold">Playing</span>}
    </button>
  )
}

/** /big: full-screen, couch-friendly library for a controller or keyboard. */
export function BigPicturePage(): React.JSX.Element {
  const navigate = useNavigate()
  const { games, launch, sessions } = useLibrary()
  const collections = useCollections()
  const [selected, setSelected] = useState<{ row: number; col: number }>({ row: 0, col: 0 })
  const rowsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.vanity.window.setFullScreen(true)
    return () => void window.vanity.window.setFullScreen(false)
  }, [])

  const rows = useMemo((): Row[] => {
    const visible = games.filter((g) => !g.hidden)
    const byName = [...visible].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    const list: Row[] = [
      { id: 'recent', title: 'Continue playing', games: visible.filter((g) => g.lastPlayedAt).sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)).slice(0, 15) },
      { id: 'fav', title: 'Favorites', games: byName.filter((g) => g.favorite) },
      { id: 'backlog', title: 'Up next from your backlog', games: byName.filter((g) => g.playStatus === 'backlog' || g.playStatus === 'playing') },
      ...collections.map((c) => ({ id: `c${c.id}`, title: c.name, games: byName.filter((g) => g.collections.includes(c.id)) })),
      { id: 'all', title: 'All games', games: byName }
    ]
    return list.filter((r) => r.games.length > 0)
  }, [games, collections])

  const game = rows[selected.row]?.games[selected.col] ?? rows[0]?.games[0] ?? null

  const focusTile = useCallback((row: number, col: number) => {
    const el = rowsRef.current?.querySelector<HTMLElement>(`[data-bp-row="${row}"][data-bp-col="${col}"]`)
    if (!el) return
    el.focus({ preventScroll: true })
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [])

  // Start on the first game.
  useEffect(() => {
    const t = setTimeout(() => focusTile(0, 0), 80)
    return () => clearTimeout(t)
  }, [focusTile, rows.length])

  const move = useCallback(
    (dRow: number, dCol: number) => {
      const row = Math.max(0, Math.min(rows.length - 1, selected.row + dRow))
      const col = Math.max(0, Math.min((rows[row]?.games.length ?? 1) - 1, dRow ? Math.min(selected.col, (rows[row]?.games.length ?? 1) - 1) : selected.col + dCol))
      focusTile(row, col)
    },
    [rows, selected, focusTile]
  )

  const exit = useCallback(() => {
    void window.vanity.window.setFullScreen(false)
    navigate('/library')
  }, [navigate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const keys: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
      if (keys[e.key]) {
        e.preventDefault()
        move(...keys[e.key])
      } else if (e.key === 'Escape') exit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, exit])

  useGamepadHandler(
    useCallback(
      (a) => {
        const dirs: Partial<Record<string, [number, number]>> = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }
        const d = dirs[a]
        if (d) move(d[0], d[1])
        else if (a === 'back') exit()
        else if ((a === 'confirm' || a === 'play') && game) void launch(game.id)
        else if (a === 'options' && game) navigate(`/game/${game.id}`)
        else if (a === 'prevTab') move(-1, 0)
        else if (a === 'nextTab') move(1, 0)
        else return false
        return true
      },
      [move, exit, game, launch, navigate]
    )
  )

  const lvl = levelFor(totalXp(games))
  const hero = game ? (mediaUrl(game.heroPath) ?? mediaUrl(game.coverPath)) : null
  const logo = game ? mediaUrl(game.logoPath) : null

  // Rendered at the top level so nothing (page transitions, the session recap) can sit above it.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-[#050608] text-white">
      {/* Background: the selected game's art, cross-fading as you move. */}
      <div key={game?.id ?? 'none'} className="absolute inset-0 animate-[fade-in_700ms_ease-out]">
        {hero ? (
          <img src={hero} alt="" className="size-full object-cover opacity-55" draggable={false} />
        ) : game ? (
          <div className="size-full" style={{ background: `radial-gradient(90% 90% at 70% 20%, hsl(${nameHue(game.name)} 55% 28%), transparent 70%)` }} />
        ) : null}
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-[#050608] via-[#050608]/70 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#050608] via-[#050608]/40 to-transparent" />

      <header className="relative z-10 flex items-center gap-4 px-14 pt-10 text-lg">
        <span className="font-display text-2xl font-black tracking-tight">Vanity</span>
        <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold">
          Level {lvl.level} · {lvl.title}
        </span>
        <span className="ml-auto text-sm text-white/40">Arrows to move · Enter to play · Esc to exit</span>
        <span className="text-white/80">
          <Clock />
        </span>
        <button onClick={exit} className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur transition hover:bg-white/20">
          <LogOut className="size-4" /> Exit
        </button>
      </header>

      {game ? (
        <section className="relative z-10 flex min-h-0 flex-1 flex-col justify-end px-14 pb-6">
          <div key={game.id} className="max-w-3xl animate-[fade-in_400ms_ease-out]">
            {logo ? (
              <img src={logo} alt={game.name} className="max-h-40 max-w-xl object-contain object-left drop-shadow-2xl" draggable={false} />
            ) : (
              <h1 className="font-display text-6xl font-black leading-[1.05] tracking-tight drop-shadow-2xl">{game.name}</h1>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-lg text-white/80">
              <span>{game.playtimeSeconds ? formatPlaytime(game.playtimeSeconds) : 'Not played yet'}</span>
              {game.lastPlayedAt && <span>Last played {formatRelativeDate(game.lastPlayedAt).toLowerCase()}</span>}
              {game.playStatus && <span className={cn('rounded-full px-3 py-0.5 text-sm font-semibold ring-1', STATUS_STYLES[game.playStatus])}>{PLAY_STATUS_LABELS[game.playStatus]}</span>}
              {game.userRating && (
                <span className="flex">
                  {Array.from({ length: game.userRating }, (_, i) => (
                    <Star key={i} className="size-5 fill-amber-400 text-amber-400" />
                  ))}
                </span>
              )}
            </div>
            {game.description && <p className="mt-4 line-clamp-2 max-w-2xl text-lg leading-relaxed text-white/70">{game.description}</p>}
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => void launch(game.id)}
                disabled={!!sessions[game.id]}
                tabIndex={-1}
                className="flex items-center gap-3 rounded-xl bg-accent px-8 py-3.5 text-xl font-bold shadow-xl shadow-accent/30 transition hover:scale-105 disabled:opacity-60"
              >
                <Play className="size-6 fill-current" /> {sessions[game.id] ? (sessions[game.id] === 'running' ? 'Playing' : 'Launching…') : 'Play'}
              </button>
              <button onClick={() => navigate(`/game/${game.id}`)} tabIndex={-1} className="flex items-center gap-2 rounded-xl bg-white/10 px-6 py-3.5 text-lg font-semibold backdrop-blur transition hover:bg-white/20">
                <Info className="size-5" /> Details
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="relative z-10 flex flex-1 items-center justify-center text-xl text-white/70">Your library is empty. Exit and scan for games first.</section>
      )}

      <div ref={rowsRef} className="relative z-10 max-h-[46vh] shrink-0 space-y-6 overflow-y-hidden pb-10">
        {rows.map((r, ri) => (
          <section key={r.id} className={cn('transition-opacity duration-300', Math.abs(ri - selected.row) > 1 && 'opacity-40')}>
            <h2 className={cn('mb-3 px-14 text-lg font-semibold transition-colors', ri === selected.row ? 'text-white' : 'text-white/60')}>{r.title}</h2>
            <div className="flex gap-5 overflow-x-hidden px-14 py-5">
              {r.games.map((g, ci) => (
                <Tile
                  key={g.id}
                  game={g}
                  row={ri}
                  col={ci}
                  selected={ri === selected.row && ci === selected.col}
                  running={!!sessions[g.id]}
                  onFocus={() => setSelected({ row: ri, col: ci })}
                  onPlay={() => void launch(g.id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>,
    document.body
  )
}
