import { memo, useMemo } from 'react'
import { CalendarClock, Flame } from 'lucide-react'
import type { UpcomingGame } from '@shared/types'
import { formatCompact } from '@/lib/format'
import { nameHue } from '@/lib/media'
import { weightedSample } from '@/lib/sample'
import { StoreIcon } from './StoreIcon'

const SHOWN = 12
const SECONDS_PER_CARD = 7

function releaseLabel(iso: string, now = Date.now()): string {
  const date = new Date(`${iso}T00:00:00`)
  const days = Math.ceil((date.getTime() - now) / 86_400_000)
  if (days <= 0) return 'Out now'
  if (days === 1) return 'Out tomorrow'
  if (days <= 14) return `Out in ${days} days`
  return `Coming ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

const BannerCard = memo(function BannerCard({ game, onSelect, hidden }: { game: UpcomingGame; onSelect: (g: UpcomingGame) => void; hidden?: boolean }): React.JSX.Element {
  const hue = nameHue(game.title)
  const art = game.bannerUrl ?? game.coverUrl
  return (
    <button
      onClick={() => onSelect(game)}
      title={`${game.title}: ${releaseLabel(game.releaseDate)}`}
      // The second copy of the strip is decorative: keep it out of the tab order and screen readers.
      tabIndex={hidden ? -1 : 0}
      aria-hidden={hidden}
      className="group relative aspect-[21/10] w-[400px] shrink-0 overflow-hidden rounded-2xl bg-surface-2 text-left shadow-xl shadow-black/40 ring-1 ring-white/5 outline-none transition duration-300 hover:-translate-y-1 hover:shadow-2xl hover:ring-white/25 focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 24%), hsl(${(hue + 40) % 360} 45% 9%))` }} />
      {art && (
        <img
          src={art}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className={`absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 ${game.bannerUrl ? '' : 'scale-110 opacity-70 blur-md'}`}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

      <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
        <CalendarClock className="size-3.5 text-accent" />
        {releaseLabel(game.releaseDate)}
      </span>

      <div className="absolute inset-x-4 bottom-3.5">
        <p className="truncate text-lg font-bold text-white drop-shadow">{game.title}</p>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-xs text-white/70">
            <Flame className="size-3.5" /> {formatCompact(game.hype)} following
          </span>
          <span className="flex gap-1">
            {game.stores.map((s) => (
              <StoreIcon key={s.launcher} launcher={s.launcher} />
            ))}
          </span>
        </div>
      </div>
    </button>
  )
})

/** Slowly scrolling strip of upcoming games at the top of Trending. Hover to pause. */
export function ComingSoonBanner({ games, onSelect }: { games: UpcomingGame[]; onSelect: (g: UpcomingGame) => void }): React.JSX.Element | null {
  // A new random pick per visit; stable while the list doesn't change.
  const ids = games.map((g) => g.id).join(',')
  const picked = useMemo(() => weightedSample(games, SHOWN), [ids]) // eslint-disable-line react-hooks/exhaustive-deps

  if (picked.length === 0) return null
  const scrolls = picked.length >= 3

  return (
    <section className="mb-10">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted">
        <CalendarClock className="size-4" /> Coming soon
      </h2>
      <div
        className="marquee -mx-10 overflow-hidden px-10 py-2 [mask-image:linear-gradient(to_right,transparent,black_40px,black_calc(100%-40px),transparent)]"
        aria-label="Upcoming games"
      >
        {scrolls ? (
          <div className="animate-marquee flex w-max" style={{ '--marquee-duration': `${picked.length * SECONDS_PER_CARD}s` } as React.CSSProperties}>
            {[0, 1].map((copy) => (
              <div key={copy} className="flex gap-5 pr-5">
                {picked.map((g) => (
                  <BannerCard key={g.id} game={g} onSelect={onSelect} hidden={copy === 1} />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-5">
            {picked.map((g) => (
              <BannerCard key={g.id} game={g} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
