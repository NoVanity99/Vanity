import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, Check, Coffee, Flame, Info, Play, Shuffle, Sparkles, Users, X, Zap, type LucideIcon } from 'lucide-react'
import type { PlayStats } from '@shared/ipc'
import { cn } from '@/lib/cn'
import { mediaUrl, nameHue } from '@/lib/media'
import { loadPref, savePref } from '@/lib/storage'
import { MOODS, TIMES, timeLabel, vibeCheck, type Mood, type VibePick } from '@/lib/vibe'
import { useLibrary } from '@/state/library'

// Opening from anywhere (Library button, Ctrl+K).
const openers = new Set<() => void>()
export function openVibeCheck(): void {
  for (const fn of openers) fn()
}

const MOOD_ICONS: Record<Mood, LucideIcon> = { chill: Coffee, intense: Flame, story: BookOpen, quick: Zap, social: Users, new: Sparkles }
const MOOD_COLORS: Record<Mood, string> = {
  chill: 'from-emerald-400/30 to-teal-500/10',
  intense: 'from-red-500/35 to-orange-500/10',
  story: 'from-violet-500/35 to-indigo-500/10',
  quick: 'from-amber-400/35 to-yellow-500/10',
  social: 'from-sky-400/35 to-blue-500/10',
  new: 'from-fuchsia-500/35 to-pink-500/10'
}

interface Prefs {
  minutes: number
  mood: Mood
}

/** "What should I play?": pick your time and mood, get three picks from your own library. */
export function VibeCheck(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = (): void => setOpen(true)
    openers.add(show)
    return () => {
      openers.delete(show)
    }
  }, [])
  return open ? <VibeDialog onClose={() => setOpen(false)} /> : null
}

function PickCard({ pick, index, rank, onPlay, onOpen }: { pick: VibePick; index: number; rank: number; onPlay: () => void; onOpen: () => void }): React.JSX.Element {
  const cover = mediaUrl(pick.game.coverPath)
  const hue = nameHue(pick.game.name)
  return (
    <div
      className="animate-card-in flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface-2/80 shadow-xl shadow-black/40"
      style={{ '--i': index * 4 } as React.CSSProperties}
    >
      <div className="relative aspect-[3/4] max-h-64 overflow-hidden" style={{ background: `linear-gradient(160deg, hsl(${hue} 45% 26%), hsl(${(hue + 40) % 360} 45% 10%))` }}>
        {cover ? (
          <img src={cover} alt="" className="size-full object-cover" draggable={false} />
        ) : (
          // No cover: a big initial (the name is shown along the bottom).
          <span aria-hidden className="absolute inset-0 flex items-center justify-center text-8xl font-black text-white/10">
            {pick.game.name.trim().charAt(0).toUpperCase()}
          </span>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        {rank === 0 && <span className="absolute left-3 top-3 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-lg">Top pick</span>}
        <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold tabular-nums text-white backdrop-blur">{pick.match}% match</span>
        <p className="absolute inset-x-3 bottom-3 truncate text-lg font-bold text-white drop-shadow">{pick.game.name}</p>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <ul className="flex-1 space-y-1.5 text-sm">
          {pick.reasons.length ? (
            pick.reasons.map((r) => (
              <li key={r} className="flex gap-2 text-text/85">
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                <span>{r}</span>
              </li>
            ))
          ) : (
            <li className="text-muted">A wildcard from your library.</li>
          )}
        </ul>
        <div className="mt-4 flex gap-2">
          <button onClick={onPlay} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-bold text-white transition hover:brightness-110">
            <Play className="size-4 fill-current" /> Play
          </button>
          <button onClick={onOpen} title="Open the game page" aria-label={`Open ${pick.game.name}`} className="rounded-xl border border-border px-3 transition hover:border-white/25">
            <Info className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function VibeDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const navigate = useNavigate()
  const { games, launch } = useLibrary()
  const [prefs, setPrefs] = useState<Prefs>(() => loadPref('vibe-check', { minutes: 60, mood: 'chill' as Mood }))
  const [stats, setStats] = useState<PlayStats | null>(null)
  const [seed, setSeed] = useState<number | null>(null)
  // Shuffle shows the next three best matches, wrapping around.
  const [page, setPage] = useState(0)

  useEffect(() => {
    window.vanity.stats.get().then(setStats, () => setStats({ recent: [] } as unknown as PlayStats))
  }, [])
  useEffect(() => savePref('vibe-check', prefs), [prefs])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ranked = useMemo(
    () => (seed === null || !stats ? [] : vibeCheck({ games, sessions: stats.recent, minutes: prefs.minutes, mood: prefs.mood, seed }, 12)),
    [seed, stats, games, prefs]
  )
  const pages = Math.max(1, Math.ceil(ranked.length / 3))
  const picks = ranked.slice((page % pages) * 3, (page % pages) * 3 + 3)
  const find = useCallback(() => {
    setPage(0)
    setSeed(Math.floor(Math.random() * 1e6))
  }, [])
  const mood = MOODS.find((m) => m.id === prefs.mood)!

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-[fade-in_150ms_ease-out] items-center justify-center bg-black/70 p-6 backdrop-blur-md" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Vibe Check" className="relative max-h-full w-full max-w-4xl animate-[dialog-in_200ms_ease-out] overflow-y-auto rounded-3xl border border-white/10 bg-surface/95 p-8 shadow-2xl shadow-black/60">
        <div aria-hidden className={cn('pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b opacity-70 transition-colors duration-700', MOOD_COLORS[prefs.mood])} />
        <button onClick={onClose} aria-label="Close" className="absolute right-5 top-5 rounded-full p-2 text-muted transition hover:bg-white/10 hover:text-text">
          <X className="size-5" />
        </button>

        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">Vibe Check</p>
          <h2 className="mt-1 font-display text-3xl font-black tracking-tight">{seed === null ? 'What should I play?' : `${mood.label}, ${timeLabel(prefs.minutes).toLowerCase()}`}</h2>

          {seed === null ? (
            <>
              <p className="mt-2 text-sm text-muted">Tell Vanity how much time you have and what you're in the mood for. It picks from your library, based on how you actually play.</p>

              <h3 className="mb-3 mt-7 text-xs font-semibold uppercase tracking-widest text-muted">How much time do you have?</h3>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Time">
                {TIMES.map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={prefs.minutes === m}
                    onClick={() => setPrefs((p) => ({ ...p, minutes: m }))}
                    className={cn(
                      'rounded-full border px-4 py-2 text-sm font-semibold transition',
                      prefs.minutes === m ? 'border-accent bg-accent text-white shadow-lg shadow-accent/30' : 'border-border text-muted hover:border-white/25 hover:text-text'
                    )}
                  >
                    {timeLabel(m)}
                  </button>
                ))}
              </div>

              <h3 className="mb-3 mt-7 text-xs font-semibold uppercase tracking-widest text-muted">What's the vibe?</h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3" role="radiogroup" aria-label="Mood">
                {MOODS.map((m) => {
                  const Icon = MOOD_ICONS[m.id]
                  const active = prefs.mood === m.id
                  return (
                    <button
                      key={m.id}
                      role="radio"
                      aria-checked={active}
                      onClick={() => setPrefs((p) => ({ ...p, mood: m.id }))}
                      className={cn(
                        'group relative overflow-hidden rounded-2xl border p-4 text-left transition duration-200 hover:-translate-y-0.5',
                        active ? 'border-accent ring-2 ring-accent/40' : 'border-border hover:border-white/25'
                      )}
                    >
                      <span className={cn('absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-300 group-hover:opacity-60', MOOD_COLORS[m.id], active && 'opacity-100')} />
                      <span className="relative flex items-center gap-3">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-white/10">
                          <Icon className="size-5" />
                        </span>
                        <span>
                          <span className="block font-semibold">{m.label}</span>
                          <span className="block text-xs text-muted">{m.hint}</span>
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <button
                onClick={find}
                disabled={!stats || games.length === 0}
                className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-accent to-accent-2 py-4 text-lg font-bold text-white shadow-xl shadow-accent/30 transition hover:brightness-110 disabled:opacity-50"
              >
                <Sparkles className="size-5" /> {games.length === 0 ? 'Add some games first' : 'Find my game'}
              </button>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">Here's what fits right now.</p>
              {picks.length === 0 ? (
                <p className="mt-10 text-center text-muted">Nothing in your library fits that. Try another vibe.</p>
              ) : (
                <div className="mt-6 grid gap-5 md:grid-cols-3">
                  {picks.map((p, i) => (
                    <PickCard
                      key={`${seed}-${page}-${p.game.id}`}
                      pick={p}
                      index={i}
                      rank={(page % pages) * 3 + i}
                      onPlay={() => {
                        onClose()
                        void launch(p.game.id)
                      }}
                      onOpen={() => {
                        onClose()
                        navigate(`/game/${p.game.id}`)
                      }}
                    />
                  ))}
                </div>
              )}
              <div className="mt-6 flex flex-wrap justify-between gap-3">
                <button onClick={() => setSeed(null)} className="flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold transition hover:border-white/25">
                  <ArrowLeft className="size-4" /> Change vibe
                </button>
                {ranked.length > 3 && (
                  <button onClick={() => setPage((n) => n + 1)} className="flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold transition hover:border-white/25">
                    <Shuffle className="size-4" /> Show me others
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
