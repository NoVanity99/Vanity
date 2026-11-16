import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, ExternalLink, FolderOpen, Heart, Play, Square, Star, X } from 'lucide-react'
import { PLAY_STATUS_LABELS, SOURCE_LABELS, type Game, type GameDetails, type GamePlayStats, type PlayStatus } from '@shared/types'
import { cn } from '@/lib/cn'
import { formatPlaytime, formatRelativeDate } from '@/lib/format'
import { mediaUrl, nameHue } from '@/lib/media'
import { useLibrary } from '@/state/library'

/**
 * A game's details inside Big Picture: full screen, sized for a TV, and driven by a controller
 * (the d-pad moves between the big buttons, A presses, B goes back, the right stick scrolls).
 * It's a dialog, so controller focus stays inside it until it closes.
 */
export function BigPictureDetails({ game, onClose, onFullPage }: { game: Game; onClose: () => void; onFullPage: () => void }): React.JSX.Element {
  const { launch, install, stop, sessions, updateGame, openFolder } = useLibrary()
  const [details, setDetails] = useState<GameDetails | null>(null)
  const [stats, setStats] = useState<GamePlayStats | null>(null)
  const [shot, setShot] = useState<number | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const first = useRef<HTMLButtonElement>(null)
  const session = sessions[game.id]

  useEffect(() => {
    let alive = true
    void window.vanity.games.details(game.id, false).then((d) => alive && setDetails(d), () => {})
    void window.vanity.games.playStats(game.id).then((s) => alive && setStats(s), () => {})
    return () => {
      alive = false
    }
  }, [game.id])

  // Start on the main button, so A plays straight away.
  useEffect(() => {
    const t = setTimeout(() => first.current?.focus({ preventScroll: true }), 60)
    return () => clearTimeout(t)
  }, [])

  // Escape (or B on a controller) closes the screenshot first, then this.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      if (shot !== null) setShot(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [shot, onClose])

  useEffect(() => {
    if (!confirmStop) return
    const t = setTimeout(() => setConfirmStop(false), 4000)
    return () => clearTimeout(t)
  }, [confirmStop])

  const hero = mediaUrl(game.heroPath) ?? mediaUrl(game.coverPath)
  const logo = mediaUrl(game.logoPath)
  const shots = details?.screenshots ?? []
  const big = 'flex min-h-16 items-center gap-3 rounded-2xl px-7 text-xl font-bold outline-none transition focus-visible:scale-105 focus:ring-4 focus:ring-white/80'
  const chip = (on: boolean): string => cn('min-h-14 rounded-xl px-5 text-lg font-semibold outline-none transition focus:ring-4 focus:ring-white/80', on ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20')

  const main = !game.installed ? (
    <button ref={first} onClick={() => void install(game.id)} className={cn(big, 'bg-accent shadow-xl shadow-accent/30')} data-bp-main>
      <Download className="size-7" /> Install
    </button>
  ) : (
    <button ref={first} onClick={() => void launch(game.id)} disabled={!!session} className={cn(big, 'bg-accent shadow-xl shadow-accent/30 disabled:opacity-70')} data-bp-main>
      <Play className="size-7 fill-current" /> {session ? (session === 'running' ? 'Playing' : 'Starting…') : 'Play'}
    </button>
  )

  const facts: [string, string][] = [
    ['Playtime', game.playtimeSeconds ? formatPlaytime(game.playtimeSeconds) : 'Not played yet'],
    ['Last played', game.lastPlayedAt ? formatRelativeDate(game.lastPlayedAt) : 'Never'],
    ['Sessions', stats ? String(stats.sessions) : '…'],
    ['Average session', stats?.sessions ? formatPlaytime(stats.averageSeconds) : '—'],
    ['Longest session', stats?.longest ? formatPlaytime(stats.longest.seconds) : '—'],
    ['Most played rank', stats?.rank ? `#${stats.rank} of ${stats.playedGames}` : '—']
  ]

  return (
    <div role="dialog" aria-modal="true" aria-label={`${game.name}: details`} className="fixed inset-0 z-[62] animate-[fade-in_250ms_ease-out] bg-[#050608] text-white" data-bp-details>
      <div className="absolute inset-0">
        {hero ? <img src={hero} alt="" className="size-full object-cover opacity-40" draggable={false} /> : <div className="size-full" style={{ background: `radial-gradient(90% 90% at 70% 20%, hsl(${nameHue(game.name)} 55% 28%), transparent 70%)` }} />}
        <div className="absolute inset-0 bg-gradient-to-r from-[#050608] via-[#050608]/85 to-[#050608]/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050608] via-transparent to-transparent" />
      </div>

      <div className="relative h-full overflow-y-auto px-[6vw] pb-[12vh] pt-[5vh] [scrollbar-width:none]" data-bp-details-scroll>
        <button onClick={onClose} className="flex min-h-14 items-center gap-3 rounded-xl bg-white/10 px-5 text-lg font-semibold outline-none transition hover:bg-white/20 focus:ring-4 focus:ring-white/80" data-bp-back>
          <ArrowLeft className="size-6" /> Back
        </button>

        <div className="mt-[4vh] max-w-[70vw]">
          {logo ? <img src={logo} alt={game.name} className="max-h-[18vh] max-w-[40vw] object-contain object-left drop-shadow-2xl" draggable={false} /> : <h1 className="font-display text-[clamp(2.5rem,5vw,5.5rem)] font-black leading-[1.05] tracking-tight">{game.name}</h1>}
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[clamp(1rem,1.4vw,1.5rem)] text-white/75">
            <span>{SOURCE_LABELS[game.source]}</span>
            {game.releaseDate && <span>{game.releaseDate.slice(0, 4)}</span>}
            {game.developer && <span>{game.developer}</span>}
            {game.genres.length > 0 && <span>{game.genres.slice(0, 3).join(' · ')}</span>}
          </p>
        </div>

        <div className="mt-[4vh] flex flex-wrap items-center gap-4">
          {main}
          {session === 'running' && (
            <button onClick={() => (confirmStop ? (setConfirmStop(false), void stop(game.id)) : setConfirmStop(true))} className={cn(big, confirmStop ? 'bg-red-600' : 'bg-white/10 hover:bg-white/20')} data-bp-stop>
              <Square className="size-6 fill-current" /> {confirmStop ? 'Press again to close the game' : 'Close game'}
            </button>
          )}
          <button onClick={() => void updateGame(game.id, { favorite: !game.favorite })} className={cn(big, game.favorite ? 'bg-pink-600' : 'bg-white/10 hover:bg-white/20')} aria-pressed={game.favorite} data-bp-favorite>
            <Heart className={cn('size-6', game.favorite && 'fill-current')} /> {game.favorite ? 'Favorite' : 'Add to favorites'}
          </button>
          {game.installed && (
            <button onClick={() => openFolder(game.id)} className={cn(big, 'bg-white/10 hover:bg-white/20')}>
              <FolderOpen className="size-6" /> Open folder
            </button>
          )}
          <button onClick={onFullPage} className={cn(big, 'bg-white/10 hover:bg-white/20')} data-bp-full-page>
            <ExternalLink className="size-6" /> Full page
          </button>
        </div>

        <section className="mt-[5vh]">
          <h2 className="text-[clamp(1.1rem,1.5vw,1.6rem)] font-semibold text-white/70">Status</h2>
          <div className="mt-3 flex flex-wrap gap-3" role="radiogroup" aria-label="Status">
            {([null, ...(Object.keys(PLAY_STATUS_LABELS) as PlayStatus[])] as (PlayStatus | null)[]).map((s) => (
              <button key={s ?? 'none'} role="radio" aria-checked={game.playStatus === s} onClick={() => void updateGame(game.id, { playStatus: s })} className={chip(game.playStatus === s)} data-bp-status={s ?? 'none'}>
                {s ? PLAY_STATUS_LABELS[s] : 'No status'}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-[4vh]">
          <h2 className="text-[clamp(1.1rem,1.5vw,1.6rem)] font-semibold text-white/70">Your rating</h2>
          <div className="mt-3 flex flex-wrap gap-3" role="radiogroup" aria-label="Your rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} role="radio" aria-checked={game.userRating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => void updateGame(game.id, { userRating: game.userRating === n ? null : n })} className={cn('flex size-16 items-center justify-center rounded-xl bg-white/10 outline-none transition hover:bg-white/20 focus:ring-4 focus:ring-white/80')} data-bp-star={n}>
                <Star className={cn('size-8', (game.userRating ?? 0) >= n ? 'fill-amber-400 text-amber-400' : 'text-white/50')} />
              </button>
            ))}
          </div>
        </section>

        <section className="mt-[5vh] grid max-w-[80vw] grid-cols-3 gap-4 max-lg:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-white/[0.07] p-5 backdrop-blur">
              <p className="text-[clamp(0.85rem,1vw,1.1rem)] font-semibold uppercase tracking-widest text-white/50">{k}</p>
              <p className="mt-1 text-[clamp(1.4rem,2vw,2.2rem)] font-bold">{v}</p>
            </div>
          ))}
        </section>

        {(game.description || details?.storyline) && (
          <section className="mt-[5vh] max-w-[70vw]">
            <h2 className="text-[clamp(1.1rem,1.5vw,1.6rem)] font-semibold text-white/70">About</h2>
            {/* Focusable, so the controller can reach it and the stick scrolls through it. */}
            <p tabIndex={0} className="mt-3 whitespace-pre-line rounded-xl text-[clamp(1.05rem,1.35vw,1.5rem)] leading-relaxed text-white/85 outline-none focus:ring-4 focus:ring-white/40">
              {game.description ?? details?.storyline}
            </p>
          </section>
        )}

        {details?.timeToBeat && (details.timeToBeat.main || details.timeToBeat.completionist) && (
          <section className="mt-[5vh]">
            <h2 className="text-[clamp(1.1rem,1.5vw,1.6rem)] font-semibold text-white/70">Time to beat</h2>
            <p className="mt-2 flex flex-wrap gap-8 text-[clamp(1.1rem,1.5vw,1.7rem)]">
              {details.timeToBeat.main && <span>Main story: <b>{formatPlaytime(details.timeToBeat.main)}</b></span>}
              {details.timeToBeat.extra && <span>With extras: <b>{formatPlaytime(details.timeToBeat.extra)}</b></span>}
              {details.timeToBeat.completionist && <span>Everything: <b>{formatPlaytime(details.timeToBeat.completionist)}</b></span>}
            </p>
          </section>
        )}

        {shots.length > 0 && (
          <section className="mt-[5vh]">
            <h2 className="text-[clamp(1.1rem,1.5vw,1.6rem)] font-semibold text-white/70">Screenshots</h2>
            <div className="mt-3 grid grid-cols-4 gap-4 max-lg:grid-cols-3">
              {shots.slice(0, 8).map((s, i) => (
                <button key={s.thumb} onClick={() => setShot(i)} className="aspect-video overflow-hidden rounded-xl bg-white/5 outline-none transition focus:scale-105 focus:ring-4 focus:ring-white/80" aria-label={`Screenshot ${i + 1}`} data-bp-shot>
                  <img src={s.thumb} alt="" className="size-full object-cover" loading="lazy" draggable={false} />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {shot !== null && shots[shot] && (
        <div role="dialog" aria-modal="true" aria-label="Screenshot" className="fixed inset-0 z-[63] flex items-center justify-center bg-black/95" onClick={() => setShot(null)}>
          <img src={shots[shot].full} alt="" className="max-h-[92vh] max-w-[94vw] rounded-xl object-contain" draggable={false} />
          <div className="absolute bottom-[4vh] flex gap-4">
            <button onClick={(e) => (e.stopPropagation(), setShot((shot + shots.length - 1) % shots.length))} className={chip(false)} autoFocus>
              Previous
            </button>
            <button onClick={(e) => (e.stopPropagation(), setShot((shot + 1) % shots.length))} className={chip(false)}>
              Next
            </button>
            <button onClick={() => setShot(null)} className={chip(false)}>
              <X className="inline size-5" /> Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
