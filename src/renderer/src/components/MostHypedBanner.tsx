import { memo } from 'react'
import { Bell, BellRing, CalendarClock, Flame } from 'lucide-react'
import type { UpcomingGame } from '@shared/types'
import { cn } from '@/lib/cn'
import { formatCompact } from '@/lib/format'
import { nameHue } from '@/lib/media'
import { StoreIcon } from './StoreIcon'

const SHOWN = 30
const SECONDS_PER_CARD = 8

export function releaseLabel(iso: string, now = Date.now()): string {
  const date = new Date(`${iso}T00:00:00`)
  const days = Math.ceil((date.getTime() - now) / 86_400_000)
  if (days <= 0) return 'Out now'
  if (days === 1) return 'Out tomorrow'
  if (days <= 30) return `Out in ${days} days`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function FollowButton({ game, following, onFollow, className }: { game: UpcomingGame; following: boolean; onFollow: (g: UpcomingGame, on: boolean) => void; className?: string }): React.JSX.Element {
  return (
    <button
      onClick={() => onFollow(game, !following)}
      aria-pressed={following}
      title={following ? 'Following: Vanity will remind you on release day. Click to stop.' : 'Remind me when it comes out'}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur transition hover:scale-105',
        following ? 'bg-accent text-white shadow-lg shadow-accent/30' : 'bg-black/55 text-white/85 hover:bg-black/75',
        className
      )}
    >
      {following ? <BellRing className="size-3.5" /> : <Bell className="size-3.5" />}
      {following ? 'Following' : 'Follow'}
    </button>
  )
}

const BannerCard = memo(function BannerCard({
  game,
  maxHype,
  following,
  onSelect,
  onFollow,
  hidden
}: {
  game: UpcomingGame
  maxHype: number
  following: boolean
  onSelect: (g: UpcomingGame) => void
  onFollow: (g: UpcomingGame, on: boolean) => void
  hidden?: boolean
}): React.JSX.Element {
  const hue = nameHue(game.title)
  const art = game.bannerUrl ?? game.coverUrl
  const top3 = game.hypeRank <= 3
  return (
    // The second copy of the strip is decorative: inert keeps it out of the tab order, controller focus and screen readers.
    <div
      inert={hidden}
      className="group relative aspect-[21/10] w-[420px] shrink-0 overflow-hidden rounded-2xl bg-surface-2 shadow-xl shadow-black/40 ring-1 ring-white/5 transition duration-300 focus-within:ring-2 focus-within:ring-accent hover:-translate-y-1 hover:shadow-2xl hover:ring-white/25"
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
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-black/10" />

      <button
        onClick={() => onSelect(game)}
        title={`${game.title}: ${releaseLabel(game.releaseDate)}`}
        className="absolute inset-0 text-left outline-none"
        aria-label={`#${game.hypeRank} most hyped: ${game.title}, ${releaseLabel(game.releaseDate)}`}
      />

      <span
        className={cn(
          'pointer-events-none absolute left-3 top-3 flex items-baseline gap-0.5 rounded-xl px-2.5 py-1 font-display font-black text-white shadow-lg backdrop-blur',
          top3 ? 'bg-gradient-to-br from-accent to-accent-2 shadow-accent/40' : 'bg-black/60'
        )}
      >
        <span className="text-xs opacity-80">#</span>
        <span className="text-xl leading-none">{game.hypeRank}</span>
      </span>
      <FollowButton game={game} following={following} onFollow={onFollow} className="absolute right-3 top-3" />

      <div className="pointer-events-none absolute inset-x-4 bottom-3.5">
        <span className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
          <CalendarClock className="size-3.5 text-accent" />
          {releaseLabel(game.releaseDate)}
        </span>
        <p className="truncate text-lg font-bold text-white drop-shadow">{game.title}</p>
        {game.genres.length > 0 && <p className="truncate text-xs text-white/60">{game.genres.join(' · ')}</p>}
        <div className="mt-2 flex items-center gap-3">
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-white/85">
            <Flame className="size-3.5 text-orange-400" /> {formatCompact(game.hype)}
          </span>
          {/* Hype relative to the #1 game. */}
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15" aria-hidden>
            <span className="block h-full rounded-full bg-gradient-to-r from-orange-400 to-accent" style={{ width: `${Math.max(4, (game.hype / maxHype) * 100)}%` }} />
          </span>
          <span className="flex shrink-0 gap-1">
            {game.stores.map((s) => (
              <StoreIcon key={s.launcher} launcher={s.launcher} />
            ))}
          </span>
        </div>
      </div>
    </div>
  )
})

/** The most anticipated upcoming PC games, in hype order, slowly scrolling at the top of Trending. Hover to pause. */
export function MostHypedBanner({
  games,
  followed,
  onSelect,
  onFollow
}: {
  games: UpcomingGame[]
  followed: number[]
  onSelect: (g: UpcomingGame) => void
  onFollow: (g: UpcomingGame, on: boolean) => void
}): React.JSX.Element | null {
  const picked = [...games].sort((a, b) => a.hypeRank - b.hypeRank || b.hype - a.hype).slice(0, SHOWN)
  if (picked.length === 0) return null
  const maxHype = Math.max(1, ...picked.map((g) => g.hype))
  const following = new Set(followed)
  const scrolls = picked.length >= 3

  const strip = (copy: number): React.JSX.Element[] =>
    picked.map((g) => (
      <BannerCard key={g.id} game={g} maxHype={maxHype} following={following.has(g.id)} onSelect={onSelect} onFollow={onFollow} hidden={copy === 1} />
    ))

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted">
          <Flame className="size-4 text-orange-400" /> Most hyped · coming soon
        </h2>
        <p className="text-xs text-muted">The upcoming PC games the most people are following, ranked by hype on IGDB.</p>
      </div>
      <div
        className="marquee -mx-10 overflow-hidden px-10 py-2 [mask-image:linear-gradient(to_right,transparent,black_40px,black_calc(100%-40px),transparent)]"
        aria-label="Most hyped upcoming games"
      >
        {scrolls ? (
          <div className="animate-marquee flex w-max" style={{ '--marquee-duration': `${picked.length * SECONDS_PER_CARD}s` } as React.CSSProperties}>
            {[0, 1].map((copy) => (
              <div key={copy} className="flex gap-5 pr-5">
                {strip(copy)}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-5">{strip(0)}</div>
        )}
      </div>
    </section>
  )
}
