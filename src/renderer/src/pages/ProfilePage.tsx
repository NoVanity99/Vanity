import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Award,
  CalendarDays,
  Check,
  Clock,
  Cloud,
  CloudOff,
  Crown,
  Flame,
  Folder,
  Gamepad2,
  Heart,
  Hourglass,
  Library,
  Lock,
  Medal,
  Play,
  RefreshCw,
  Rocket,
  Star,
  Trophy,
  UserCircle2,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { Progress, ProgressBadge, ProgressGame } from '@shared/types'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import { formatAgo, formatPlaytime, formatRelativeDate } from '@/lib/format'
import { mediaUrl, nameHue } from '@/lib/media'
import { useAccount } from '@/state/account'
import { syncNow, useProgress } from '@/state/progress'

const BADGE_ICONS: Record<string, LucideIcon> = {
  play: Play,
  gamepad: Gamepad2,
  library: Library,
  clock: Clock,
  hourglass: Hourglass,
  flame: Flame,
  calendar: CalendarDays,
  trophy: Trophy,
  crown: Crown,
  star: Star,
  heart: Heart,
  folder: Folder,
  medal: Medal,
  zap: Zap,
  award: Award
}

function Tile({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

/** Where cloud sync stands, in words, with a button to sync now. */
function SyncLine({ progress, signedIn }: { progress: Progress; signedIn: boolean }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const { status, lastSyncedAt, message } = progress.sync
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      await syncNow()
    } finally {
      setBusy(false)
    }
  }
  const syncing = busy || status === 'syncing'
  const text =
    status === 'local'
      ? signedIn
        ? 'Choose a username on the Account page to save your progress to the cloud.'
        : 'Your progress is saved on this device. Sign in to save it to the cloud and see it on your other devices.'
      : status === 'offline' || status === 'error'
        ? (message ?? 'Sync failed. Vanity will try again.')
        : syncing
          ? 'Syncing…'
          : `Saved to the cloud${lastSyncedAt ? ` ${formatAgo(lastSyncedAt)}` : ''}.`
  const Icon = status === 'synced' || status === 'syncing' ? Cloud : CloudOff
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-sm',
        status === 'offline' || status === 'error' ? 'border-amber-400/30 bg-amber-400/10 text-amber-100' : 'border-border bg-surface text-muted'
      )}
    >
      <Icon className={cn('size-4 shrink-0', status === 'synced' && 'text-emerald-400')} />
      <span className="min-w-0 flex-1">{text}</span>
      {status !== 'local' && (
        <button onClick={run} disabled={syncing} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-text transition hover:bg-white/10 disabled:opacity-60">
          <RefreshCw className={cn('size-3.5', syncing && 'animate-spin')} /> Sync now
        </button>
      )}
    </div>
  )
}

function XpSources({ progress }: { progress: Progress }): React.JSX.Element {
  const b = progress.breakdown
  const rows: [string, number, string][] = [
    ['Playing', b.playtime, 'XP for every minute played'],
    ['New games', b.firstLaunches, 'the first time you launch each game'],
    ['Days played', b.daysPlayed, 'for each day you play'],
    ['Streaks', b.streaks, 'bonus for playing days in a row'],
    ['Finishing and rating', b.journal, 'marking games Beaten or Completed, and rating them'],
    ['Steam achievements', b.steamAchievements, 'unlocks once a Steam account is linked']
  ]
  const max = Math.max(1, ...rows.map((r) => r[1]))
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Where your XP comes from</h2>
      <ul className="mt-4 space-y-3">
        {rows.map(([label, value, hint]) => (
          <li key={label} title={hint}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{label}</span>
              <span className="tabular-nums text-muted">{value.toLocaleString()} XP</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/8">
              <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${(value / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function GameLine({ game, rank, max }: { game: ProgressGame; rank: number; max: number }): React.JSX.Element {
  const navigate = useNavigate()
  const art = mediaUrl(game.coverPath) ?? mediaUrl(game.iconPath)
  const hue = nameHue(game.name)
  const here = game.gameId !== null
  return (
    <li>
      <button
        disabled={!here}
        onClick={() => here && navigate(`/game/${game.gameId}`)}
        title={here ? `Open ${game.name}` : `${game.name} isn't in this device's library`}
        className={cn('flex w-full items-center gap-3 rounded-xl p-2 text-left transition', here && 'hover:bg-white/5')}
      >
        <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-muted">{rank}</span>
        <span className="relative size-11 shrink-0 overflow-hidden rounded-lg" style={{ background: `linear-gradient(160deg, hsl(${hue} 45% 30%), hsl(${(hue + 40) % 360} 45% 14%))` }}>
          {art ? (
            <img src={art} alt="" className="size-full object-cover" draggable={false} />
          ) : (
            <span aria-hidden className="absolute inset-0 flex items-center justify-center text-lg font-black text-white/30">
              {game.name.trim().charAt(0).toUpperCase()}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{game.name}</span>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-white/8">
            <span className="block h-full rounded-full bg-accent/80" style={{ width: `${Math.max(3, (game.playtimeSeconds / max) * 100)}%` }} />
          </span>
          <span className="mt-1 block truncate text-xs text-muted">
            {game.launches.toLocaleString()} {game.launches === 1 ? 'launch' : 'launches'}
            {game.lastPlayedAt ? ` · last played ${formatRelativeDate(game.lastPlayedAt).toLowerCase()}` : ''}
            {!here && ' · on another device'}
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{formatPlaytime(game.playtimeSeconds)}</span>
      </button>
    </li>
  )
}

function Badge({ badge }: { badge: ProgressBadge }): React.JSX.Element {
  const Icon = BADGE_ICONS[badge.icon] ?? Award
  const earned = badge.unlockedAt !== null
  const pct = Math.round((badge.current / badge.target) * 100)
  return (
    <li
      title={earned ? `${badge.description} Unlocked ${new Date(badge.unlockedAt!).toLocaleDateString()}.` : `${badge.description} ${badge.current.toLocaleString()} of ${badge.target.toLocaleString()}.`}
      className={cn('relative flex flex-col items-center rounded-2xl border p-4 text-center transition', earned ? 'border-accent/40 bg-accent/10' : 'border-border bg-surface')}
    >
      <span className={cn('relative flex size-12 items-center justify-center rounded-full', earned ? 'bg-gradient-to-br from-accent to-accent-2 text-white shadow-lg shadow-accent/30' : 'bg-white/5 text-muted')}>
        <Icon className="size-5" />
        {earned ? (
          <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-surface">
            <Check className="size-3" />
          </span>
        ) : (
          <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-surface-2 text-muted ring-2 ring-surface">
            <Lock className="size-2.5" />
          </span>
        )}
      </span>
      <p className={cn('mt-3 text-sm font-semibold leading-tight', !earned && 'text-muted')}>{badge.name}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted">{badge.description}</p>
      {!earned && (
        <div className="mt-3 w-full">
          <div className="h-1 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full bg-accent/70" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-[10px] tabular-nums text-muted">
            {badge.current.toLocaleString()} / {badge.target.toLocaleString()}
          </p>
        </div>
      )}
    </li>
  )
}

export function ProfilePage(): React.JSX.Element {
  const progress = useProgress()
  const account = useAccount()
  const navigate = useNavigate()

  if (!progress) return <div className="h-full" />

  const { level, totals } = progress
  const pct = Math.min(100, Math.round((level.into / level.span) * 100))
  const name = account?.username ?? 'Player'
  const earned = progress.badges.filter((b) => b.unlockedAt !== null)
  const badges = [...earned.sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0)), ...progress.badges.filter((b) => b.unlockedAt === null)]
  const topMax = progress.topGames[0]?.playtimeSeconds ?? 1

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="stagger mx-auto max-w-5xl space-y-6 px-10 pb-16 pt-12 max-md:px-4 max-md:pt-14">
        {/* Who you are, and your level */}
        <section className="relative overflow-hidden rounded-3xl border border-border bg-surface p-7 max-md:p-5">
          <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-accent/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 size-64 rounded-full bg-accent-2/15 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-6">
            {account?.username ? (
              <Avatar name={name} size="xl" />
            ) : (
              <span className="flex size-20 items-center justify-center rounded-full bg-white/5 text-muted ring-2 ring-bg">
                <UserCircle2 className="size-10" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">{level.title}</p>
              <h1 className="truncate font-display text-4xl font-black tracking-tight max-md:text-3xl">{name}</h1>
              <p className="mt-1 text-sm text-muted">
                {earned.length} of {progress.badges.length} badges · {totals.gamesPlayed.toLocaleString()} {totals.gamesPlayed === 1 ? 'game' : 'games'} played
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="relative flex size-24 shrink-0 items-center justify-center">
                <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white/10" />
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 97.4} 97.4`} className="transition-[stroke-dasharray] duration-1000" />
                </svg>
                <span className="text-center">
                  <span className="block text-[10px] font-semibold uppercase tracking-widest text-muted">Level</span>
                  <span className="block font-display text-3xl font-black tabular-nums leading-none">{level.level}</span>
                </span>
              </span>
            </div>
          </div>

          <div className="relative mt-6" aria-label={`Level ${level.level}: ${level.into} of ${level.span} XP to level ${level.level + 1}`}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold tabular-nums">
                {level.into.toLocaleString()} <span className="font-normal text-muted">/ {level.span.toLocaleString()} XP</span>
              </span>
              <span className="text-muted">
                {(level.span - level.into).toLocaleString()} XP to level {level.level + 1}
              </span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/8">
              <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 shadow-[0_0_12px_var(--color-accent)] transition-[width] duration-1000" style={{ width: `${Math.max(pct, 1)}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted">{progress.xp.toLocaleString()} XP in all</p>
          </div>

          {!account?.signedIn && account?.available && (
            <div className="relative mt-5">
              <Button variant="primary" onClick={() => navigate('/account')}>
                <Cloud className="size-4" /> Sign in to save your progress
              </Button>
            </div>
          )}
        </section>

        <SyncLine progress={progress} signedIn={!!account?.signedIn} />

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Tile icon={Clock} label="Playtime" value={formatPlaytime(totals.playtimeSeconds)} hint="across all your devices" />
          <Tile icon={Gamepad2} label="Games played" value={totals.gamesPlayed.toLocaleString()} hint={`${totals.favorites.toLocaleString()} favourite${totals.favorites === 1 ? '' : 's'}`} />
          <Tile icon={Rocket} label="Launches" value={totals.launches.toLocaleString()} hint={`on ${totals.daysPlayed.toLocaleString()} day${totals.daysPlayed === 1 ? '' : 's'}`} />
          <Tile icon={Flame} label="Streak" value={`${totals.currentStreak} day${totals.currentStreak === 1 ? '' : 's'}`} hint={`best: ${totals.bestStreak} day${totals.bestStreak === 1 ? '' : 's'}`} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Most played</h2>
            {progress.topGames.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">Play something from your library and it shows up here.</p>
            ) : (
              <ol className="mt-3 space-y-1">
                {progress.topGames.map((g, i) => (
                  <GameLine key={g.key} game={g} rank={i + 1} max={topMax} />
                ))}
              </ol>
            )}
          </section>
          <XpSources progress={progress} />
        </div>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Badges</h2>
            <span className="text-xs tabular-nums text-muted">
              {earned.length} / {progress.badges.length} unlocked
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {badges.map((b) => (
              <Badge key={b.id} badge={b} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
