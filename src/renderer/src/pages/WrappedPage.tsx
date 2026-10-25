import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Moon, Pause, Play, Sparkles, Sunrise, Trophy, X } from 'lucide-react'
import type { PlayStats } from '@shared/ipc'
import { useGamepadHandler } from '@/gamepad/GamepadLayer'
import { cn } from '@/lib/cn'
import { formatPlaytime } from '@/lib/format'
import { mediaUrl, nameHue } from '@/lib/media'
import { computeWrapped, type Wrapped } from '@/lib/wrapped'
import { levelFor, totalXp } from '@/lib/xp'
import { useLibrary } from '@/state/library'

const SLIDE_MS = 6500

/** Counts up to `value` when it first shows. */
function useCountUp(value: number, ms = 1400): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setN(value)
    let raf = 0
    const start = performance.now()
    const tick = (t: number): void => {
      const p = Math.min(1, (t - start) / ms)
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return n
}

function Big({ value, suffix }: { value: number; suffix?: string }): React.JSX.Element {
  const n = useCountUp(value)
  return (
    <span className="font-display text-[clamp(4rem,12vw,9rem)] font-black leading-none tracking-tight tabular-nums drop-shadow-2xl">
      {n.toLocaleString()}
      {suffix && <span className="ml-3 text-[0.35em] font-bold text-white/70">{suffix}</span>}
    </span>
  )
}

function Rise({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }): React.JSX.Element {
  return (
    <div className={cn('animate-rise-in', className)} style={{ '--delay': `${delay}ms` } as React.CSSProperties}>
      {children}
    </div>
  )
}

interface Slide {
  id: string
  /** CSS background for the slide. */
  bg: string
  image?: string | null
  body: React.ReactNode
}

function slides(w: Wrapped, level: ReturnType<typeof levelFor>, xp: number, year: string): Slide[] {
  const hours = Math.round(w.totalSeconds / 3600)
  const top = w.topGames[0]
  const list: Slide[] = [
    {
      id: 'intro',
      bg: 'radial-gradient(120% 90% at 20% 10%, var(--color-accent) 0%, transparent 55%), radial-gradient(90% 80% at 90% 100%, var(--color-accent-2) 0%, transparent 60%), #07080c',
      body: (
        <>
          <Rise>
            <Sparkles className="mx-auto size-14 text-white/90" />
          </Rise>
          <Rise delay={150}>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.4em] text-white/70">Vanity Wrapped</p>
          </Rise>
          <Rise delay={300}>
            <h1 className="mt-4 font-display text-[clamp(3rem,8vw,6.5rem)] font-black leading-[0.95] tracking-tight">
              Your year
              <br />
              in games
            </h1>
          </Rise>
          <Rise delay={500}>
            <p className="mt-6 text-lg text-white/70">{year}</p>
          </Rise>
        </>
      )
    },
    {
      id: 'hours',
      bg: 'radial-gradient(100% 80% at 80% 0%, #7c3aed 0%, transparent 60%), radial-gradient(80% 70% at 0% 100%, var(--color-accent) 0%, transparent 65%), #08060f',
      body: (
        <>
          <Rise>
            <p className="text-xl text-white/80">You played for</p>
          </Rise>
          <Rise delay={150}>
            <Big value={hours} suffix={hours === 1 ? 'hour' : 'hours'} />
          </Rise>
          <Rise delay={400}>
            <p className="mt-6 text-xl text-white/80">
              across <b className="text-white">{w.sessions.toLocaleString()} sessions</b> on <b className="text-white">{w.daysPlayed} days</b>.
            </p>
          </Rise>
          <Rise delay={600}>
            <p className="mt-2 text-white/60">That's {Math.round((w.totalSeconds / 86_400) * 10) / 10} whole days of gaming.</p>
          </Rise>
        </>
      )
    }
  ]
  if (top) {
    list.push({
      id: 'top',
      bg: `linear-gradient(160deg, hsl(${nameHue(top.game.name)} 60% 22%), #050507)`,
      image: mediaUrl(top.game.heroPath) ?? mediaUrl(top.game.coverPath),
      body: (
        <>
          <Rise>
            <p className="text-xl text-white/80">Your game of the year</p>
          </Rise>
          {mediaUrl(top.game.coverPath) && (
            <Rise delay={150}>
              <img src={mediaUrl(top.game.coverPath)!} alt="" className="mx-auto mt-6 h-64 rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/20" draggable={false} />
            </Rise>
          )}
          <Rise delay={300}>
            <h2 className="mt-6 font-display text-[clamp(2.5rem,6vw,4.5rem)] font-black leading-tight">{top.game.name}</h2>
          </Rise>
          <Rise delay={450}>
            <p className="mt-2 text-xl text-white/80">
              <b className="text-white">{formatPlaytime(top.seconds)}</b>, or {Math.round((top.seconds / Math.max(1, w.totalSeconds)) * 100)}% of all your play.
            </p>
          </Rise>
        </>
      )
    })
  }
  if (w.topGames.length > 1) {
    list.push({
      id: 'top5',
      bg: 'radial-gradient(90% 70% at 100% 0%, #0ea5e9 0%, transparent 60%), radial-gradient(90% 70% at 0% 100%, #6366f1 0%, transparent 60%), #05070d',
      body: (
        <>
          <Rise>
            <p className="text-xl text-white/80">Your top {w.topGames.length}</p>
          </Rise>
          <ol className="mx-auto mt-8 w-full max-w-xl space-y-3 text-left">
            {w.topGames.map((t, i) => (
              <Rise key={t.game.id} delay={200 + i * 150}>
                <li className="flex items-center gap-4 rounded-2xl bg-white/10 p-3 ring-1 ring-white/15 backdrop-blur">
                  <span className="w-10 text-center font-display text-3xl font-black text-white/80">{i + 1}</span>
                  <span className="h-14 w-10 shrink-0 overflow-hidden rounded-md" style={{ background: `hsl(${nameHue(t.game.name)} 40% 25%)` }}>
                    {mediaUrl(t.game.coverPath) && <img src={mediaUrl(t.game.coverPath)!} alt="" className="size-full object-cover" draggable={false} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-lg font-semibold">{t.game.name}</span>
                  <span className="shrink-0 tabular-nums text-white/70">{formatPlaytime(t.seconds)}</span>
                </li>
              </Rise>
            ))}
          </ol>
        </>
      )
    })
  }
  if (w.topGenre) {
    list.push({
      id: 'genre',
      bg: 'radial-gradient(100% 80% at 50% 0%, #f59e0b 0%, transparent 60%), radial-gradient(80% 60% at 50% 100%, #dc2626 0%, transparent 65%), #0c0605',
      body: (
        <>
          <Rise>
            <p className="text-xl text-white/80">Your genre was</p>
          </Rise>
          <Rise delay={200}>
            <h2 className="mt-4 font-display text-[clamp(3rem,9vw,7rem)] font-black leading-none">{w.topGenre.name}</h2>
          </Rise>
          <Rise delay={450}>
            <p className="mt-6 text-xl text-white/80">
              {Math.round(w.topGenre.share * 100)}% of your playtime. You played <b className="text-white">{w.gamesPlayed} games</b>
              {w.newGames > 0 && (
                <>
                  , <b className="text-white">{w.newGames}</b> of them for the first time
                </>
              )}
              .
            </p>
          </Rise>
        </>
      )
    })
  }
  const owl = w.nightOwl >= w.earlyBird
  list.push({
    id: 'habits',
    bg: owl
      ? 'radial-gradient(90% 70% at 80% 10%, #312e81 0%, transparent 60%), radial-gradient(70% 60% at 10% 90%, #1e3a8a 0%, transparent 60%), #03040a'
      : 'radial-gradient(90% 70% at 50% 0%, #fb923c 0%, transparent 60%), radial-gradient(70% 60% at 50% 100%, #fde047 0%, transparent 60%), #0d0904',
    body: (
      <>
        <Rise>{owl ? <Moon className="mx-auto size-16 text-indigo-200" /> : <Sunrise className="mx-auto size-16 text-amber-200" />}</Rise>
        <Rise delay={200}>
          <h2 className="mt-6 font-display text-[clamp(2.5rem,7vw,5rem)] font-black">{owl ? 'Night owl' : 'Early bird'}</h2>
        </Rise>
        <Rise delay={400}>
          <p className="mt-4 text-xl text-white/80">
            {Math.round((owl ? w.nightOwl : w.earlyBird) * 100)}% of your sessions started {owl ? 'after 10 pm' : 'before 9 am'}.
          </p>
        </Rise>
        {(w.busiestWeekday || w.busiestMonth) && (
          <Rise delay={600}>
            <p className="mt-3 text-lg text-white/70">
              {w.busiestWeekday && (
                <>
                  Your big day was <b className="text-white">{w.busiestWeekday}</b>.{' '}
                </>
              )}
              {w.busiestMonth && (
                <>
                  Busiest month: <b className="text-white">{w.busiestMonth.label}</b> ({formatPlaytime(w.busiestMonth.seconds)}).
                </>
              )}
            </p>
          </Rise>
        )}
      </>
    )
  })
  if (w.longestSession) {
    list.push({
      id: 'records',
      bg: 'radial-gradient(100% 80% at 0% 0%, #059669 0%, transparent 60%), radial-gradient(80% 70% at 100% 100%, #0891b2 0%, transparent 60%), #030a08',
      body: (
        <>
          <Rise>
            <Trophy className="mx-auto size-14 text-emerald-200" />
          </Rise>
          <Rise delay={150}>
            <p className="mt-6 text-xl text-white/80">Your longest session</p>
          </Rise>
          <Rise delay={300}>
            <h2 className="mt-2 font-display text-[clamp(3rem,8vw,6rem)] font-black leading-none">{formatPlaytime(w.longestSession.seconds)}</h2>
          </Rise>
          <Rise delay={450}>
            <p className="mt-4 text-xl text-white/80">
              of <b className="text-white">{w.longestSession.game.name}</b> on {new Date(w.longestSession.at).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}.
            </p>
          </Rise>
          {w.longestStreak > 1 && (
            <Rise delay={650}>
              <p className="mt-3 text-lg text-white/70">
                And you played <b className="text-white">{w.longestStreak} days in a row</b>.
              </p>
            </Rise>
          )}
        </>
      )
    })
  }
  list.push({
    id: 'level',
    bg: 'radial-gradient(110% 90% at 50% 0%, var(--color-accent) 0%, transparent 60%), radial-gradient(80% 70% at 50% 100%, var(--color-accent-2) 0%, transparent 60%), #07070a',
    body: (
      <>
        <Rise>
          <p className="text-xl text-white/80">You've reached</p>
        </Rise>
        <Rise delay={200}>
          <p className="mt-4 font-display text-[clamp(4rem,12vw,9rem)] font-black leading-none">Level {level.level}</p>
        </Rise>
        <Rise delay={400}>
          <p className="mt-3 text-2xl font-semibold text-white/90">{level.title}</p>
        </Rise>
        <Rise delay={550}>
          <div className="mx-auto mt-8 h-2 w-80 overflow-hidden rounded-full bg-white/15">
            <div className="h-full origin-left rounded-full bg-white" style={{ width: `${(level.into / level.span) * 100}%`, animation: 'grow 1.2s ease-out both' }} />
          </div>
          <p className="mt-2 text-sm text-white/60">{xp.toLocaleString()} XP in all</p>
        </Rise>
      </>
    )
  })
  list.push({
    id: 'summary',
    bg: 'linear-gradient(160deg, #111318, #050608)',
    body: (
      <Rise>
        <div className="mx-auto w-full max-w-md rounded-3xl bg-gradient-to-br from-accent to-accent-2 p-[2px] shadow-2xl shadow-black/60">
          <div className="rounded-[22px] bg-[#0b0c10]/95 p-7 text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">Vanity Wrapped · {year}</p>
            <div className="mt-5 grid grid-cols-2 gap-5">
              <div>
                <p className="text-xs text-white/50">Hours played</p>
                <p className="font-display text-3xl font-black">{hours.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-white/50">Games</p>
                <p className="font-display text-3xl font-black">{w.gamesPlayed}</p>
              </div>
              <div>
                <p className="text-xs text-white/50">Top game</p>
                <p className="truncate font-semibold">{top?.game.name ?? '–'}</p>
              </div>
              <div>
                <p className="text-xs text-white/50">Top genre</p>
                <p className="truncate font-semibold">{w.topGenre?.name ?? '–'}</p>
              </div>
              <div>
                <p className="text-xs text-white/50">Longest streak</p>
                <p className="font-semibold">{w.longestStreak} days</p>
              </div>
              <div>
                <p className="text-xs text-white/50">Level</p>
                <p className="font-semibold">
                  {level.level} · {level.title}
                </p>
              </div>
            </div>
          </div>
        </div>
        <p className="mt-6 text-white/60">Thanks for playing. See you next year.</p>
      </Rise>
    )
  })
  return list
}

/** /wrapped: your last 12 months of play as a story. Click or use the arrows; Esc closes. */
export function WrappedPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { games } = useLibrary()
  const [stats, setStats] = useState<PlayStats | null>(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    window.vanity.stats.get().then(setStats, () => {})
  }, [])

  const deck = useMemo(() => {
    if (!stats) return []
    const w = computeWrapped(stats.recent, games, Date.now(), new Map(Object.entries(stats.firstPlayed).map(([k, v]) => [Number(k), v])))
    if (w.totalSeconds === 0) return []
    const xp = totalXp(games)
    const from = new Date(Date.now() - 365 * 86_400_000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    const to = new Date().toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    return slides(w, levelFor(xp), xp, `${from} – ${to}`)
  }, [stats, games])

  const close = useCallback(() => navigate(-1), [navigate])
  const step = useCallback((d: number) => setIndex((i) => Math.max(0, Math.min(deck.length - 1, i + d))), [deck.length])

  // Advance on a timer, unless paused or on the last slide.
  useEffect(() => {
    if (paused || index >= deck.length - 1) return
    const t = setTimeout(() => step(1), SLIDE_MS)
    return () => clearTimeout(t)
  }, [index, paused, deck.length, step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === ' ') {
        e.preventDefault()
        setPaused((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, step])

  useGamepadHandler(
    useCallback(
      (a) => {
        if (a === 'right' || a === 'nextTab' || a === 'confirm') step(1)
        else if (a === 'left' || a === 'prevTab') step(-1)
        else if (a === 'back') close()
        else if (a === 'play') setPaused((p) => !p)
        else return a === 'up' || a === 'down'
        return true
      },
      [step, close]
    )
  )

  const slide = deck[index]
  // Rendered at the top level so nothing (page transitions, the session recap) can sit above it.
  return createPortal(
    <div role="dialog" aria-label="Vanity Wrapped" className="fixed inset-0 z-[60] overflow-hidden bg-black text-white">
      {slide ? (
        <div key={slide.id} className="absolute inset-0 animate-[fade-in_500ms_ease-out]" style={{ background: slide.bg }}>
          {slide.image && <img src={slide.image} alt="" className="absolute inset-0 size-full scale-110 object-cover opacity-30 blur-xl" draggable={false} />}
          <div className="absolute inset-0 bg-[radial-gradient(transparent_40%,rgba(0,0,0,0.55))]" />
          <div className="relative flex h-full flex-col items-center justify-center px-10 text-center">{slide.body}</div>
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-10 text-center">
          <Sparkles className="size-12 text-accent" />
          <h1 className="text-3xl font-bold">{stats ? 'Nothing to wrap yet' : 'Wrapping your year…'}</h1>
          {stats && <p className="text-white/70">Play some games through Vanity and your Wrapped builds itself.</p>}
        </div>
      )}

      {/* Tap zones: left goes back, right goes forward. */}
      {deck.length > 1 && (
        <>
          <button aria-label="Previous" className="absolute inset-y-0 left-0 w-1/3 cursor-w-resize outline-none" onClick={() => step(-1)} tabIndex={-1} />
          <button aria-label="Next" className="absolute inset-y-0 right-0 w-2/3 cursor-e-resize outline-none" onClick={() => step(1)} tabIndex={-1} />
        </>
      )}

      <div className="absolute inset-x-0 top-0 z-10 px-6 pt-12">
        <div className="flex gap-1.5">
          {deck.map((s, i) => (
            <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
              <div
                key={`${s.id}-${index}`}
                className="h-full origin-left rounded-full bg-white"
                style={
                  i < index
                    ? { transform: 'scaleX(1)' }
                    : i === index && index < deck.length - 1
                      ? { animation: `grow ${SLIDE_MS}ms linear both`, animationPlayState: paused ? 'paused' : 'running' }
                      : i === index
                        ? { transform: 'scaleX(1)' }
                        : { transform: 'scaleX(0)' }
                }
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/70">Vanity Wrapped</span>
          <span className="flex gap-2">
            {deck.length > 1 && (
              <>
                <button onClick={() => step(-1)} aria-label="Previous slide" className="rounded-full bg-white/10 p-2 hover:bg-white/20">
                  <ChevronLeft className="size-4" />
                </button>
                <button onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play' : 'Pause'} className="rounded-full bg-white/10 p-2 hover:bg-white/20">
                  {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                </button>
                <button onClick={() => step(1)} aria-label="Next slide" className="rounded-full bg-white/10 p-2 hover:bg-white/20">
                  <ChevronRight className="size-4" />
                </button>
              </>
            )}
            <button onClick={close} aria-label="Close" className="rounded-full bg-white/10 p-2 hover:bg-white/20">
              <X className="size-4" />
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body
  )
}
