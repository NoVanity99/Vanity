import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Award, Clock, Gamepad2, Trophy, Users } from 'lucide-react'
import { BADGES, levelFor } from '@shared/progress'
import type { Friend, FriendStats } from '@shared/types'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Dialog'
import { UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { formatAgo, formatPlaytime } from '@/lib/format'
import { nameHue } from '@/lib/media'
import { useAccount } from '@/state/account'
import { useLibrary } from '@/state/library'
import { statusLine } from './FriendsPage'
import { BADGE_ICONS } from './ProfilePage'

const REFRESH_MS = 30_000
/** Matches a friend's game to one in your library by its name, ignoring capitals and punctuation. */
const plain = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '')

function Tile({ icon: Icon, label, value, hint }: { icon: typeof Clock; label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className="mt-2 truncate font-display text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
    </div>
  )
}

/** A friend's profile: their look, level, bio, what they play and the badges they've earned. */
export function FriendProfilePage(): React.JSX.Element {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const account = useAccount()
  const { library } = useLibrary()
  const [friend, setFriend] = useState<Friend | null>(null)
  const [stats, setStats] = useState<FriendStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!account?.username) return
    let cancelled = false
    setFriend(null)
    setStats(null)
    setError(null)
    const load = async (): Promise<void> => {
      const [list, s] = await Promise.all([window.vanity.friends.list(), window.vanity.friends.stats(id)]).catch(() => [null, null] as const)
      if (cancelled) return
      if (!list || !s) return setError("Couldn't reach Vanity's server. Check your connection and try again.")
      if (list.error !== undefined) return setError(list.error)
      const found = list.data.friends.find((f) => f.id === id) ?? null
      if (!found) return setError("This person isn't on your friends list (any more).")
      setFriend(found)
      if (s.error !== undefined) return setError(s.error)
      setError(null)
      setStats(s.data)
    }
    void load()
    // Their status, level and anything they change keeps up while the page is open.
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [id, account?.username])

  // Your own copies of their games, to open from here.
  const mine = useMemo(() => new Map(library.map((g) => [plain(g.name), g.id])), [library])

  const back = (
    <button onClick={() => navigate('/friends')} className="flex items-center gap-2 text-sm text-muted transition hover:text-text">
      <ArrowLeft className="size-4" /> Friends
    </button>
  )

  if (!account?.signedIn || !account.username || error || !friend) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 px-10 pb-16 pt-12 max-md:px-4 max-md:pt-14">
          {back}
          {!account?.signedIn || !account?.username ? (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
              <p className="text-sm text-muted">Sign in to your Vanity account to see your friends' profiles.</p>
              <Button variant="primary" className="mt-4" onClick={() => navigate('/account')}>
                Go to Account
              </Button>
            </div>
          ) : error ? (
            <p role="alert" className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
              {error}
            </p>
          ) : (
            <div className="shimmer h-56 rounded-3xl bg-white/[0.03]" />
          )}
        </div>
      </div>
    )
  }

  const style = stats?.style ?? friend.style
  const xp = stats?.xp ?? friend.xp
  const level = levelFor(xp)
  const pct = Math.min(100, Math.round((level.into / level.span) * 100))
  const bio = stats?.bio ?? friend.bio
  const earned = BADGES.filter((b) => stats?.badges.includes(b.id))
  const top = stats?.top ?? []
  const topMax = top[0]?.playtimeSeconds ?? 1
  const shared = top.filter((g) => mine.has(plain(g.gameName))).length
  const playing = friend.status.state === 'playing'

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden" data-friend-profile>
      <div className="stagger mx-auto max-w-5xl space-y-6 px-10 pb-16 pt-12 max-md:px-4 max-md:pt-14">
        {back}

        <section className="relative overflow-clip rounded-3xl border border-border bg-surface p-7 max-md:p-5">
          <div className="profile-banner" data-banner={style?.banner ?? 'default'} />
          <div className="relative flex flex-wrap items-center gap-6">
            <Avatar name={friend.username} src={stats?.avatar ?? friend.avatar} frame={style?.frame} size="xl" status={friend.status.state} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">{level.title}</p>
              <h1 className="font-display text-4xl font-black tracking-tight max-md:text-3xl">
                <UserName name={friend.username} style={style} verified={friend.verified} admin={friend.admin} badgeSize="lg" />
              </h1>
              {bio && <p className="mt-1.5 max-w-xl whitespace-pre-wrap break-words text-sm text-text/85">{bio}</p>}
              <p className={cn('mt-1.5 flex items-center gap-1.5 text-sm', playing ? 'text-accent' : friend.status.state === 'online' ? 'text-emerald-400' : 'text-muted')}>
                {playing && <Gamepad2 className="size-4 shrink-0" />}
                {statusLine(friend)}
              </p>
            </div>
            <span className="relative flex size-24 shrink-0 items-center justify-center">
              <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white/10" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 97.4} 97.4`} />
              </svg>
              <span className="text-center">
                <span className="block text-[10px] font-semibold uppercase tracking-widest text-muted">Level</span>
                <span className="block font-display text-3xl font-black tabular-nums leading-none">{level.level}</span>
              </span>
            </span>
          </div>
          <div className="relative mt-6">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold tabular-nums">
                {level.into.toLocaleString()} <span className="font-normal text-muted">/ {level.span.toLocaleString()} XP</span>
              </span>
              <span className="text-muted">{xp.toLocaleString()} XP in all</span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/8">
              <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2" style={{ width: `${Math.max(pct, 1)}%` }} />
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Tile icon={Clock} label="Playtime" value={formatPlaytime(stats?.totalPlaytimeSeconds ?? friend.totalPlaytimeSeconds)} />
          <Tile icon={Gamepad2} label="Games played" value={(stats?.gamesPlayed ?? friend.gamesPlayed).toLocaleString()} />
          <Tile icon={Trophy} label="Favourite game" value={top[0]?.gameName ?? friend.topGame ?? 'None yet'} hint={top[0] ? formatPlaytime(top[0].playtimeSeconds) : undefined} />
          <Tile icon={Users} label="In common" value={stats ? `${shared} game${shared === 1 ? '' : 's'}` : '…'} hint="of their most played, in your library" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Most played</h2>
            {!stats ? (
              <div className="shimmer mt-3 h-40 rounded-xl bg-white/[0.03]" />
            ) : top.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">{friend.username} hasn't shared any playtime yet.</p>
            ) : (
              <ol className="mt-3 space-y-1">
                {top.map((g, i) => {
                  const here = mine.get(plain(g.gameName))
                  const hue = nameHue(g.gameName)
                  return (
                    <li key={g.gameKey}>
                      <button
                        disabled={here === undefined}
                        onClick={() => here !== undefined && navigate(`/game/${here}`)}
                        title={here !== undefined ? `Open ${g.gameName} in your library` : `${g.gameName} isn't in your library`}
                        className={cn('flex w-full items-center gap-3 rounded-xl p-2 text-left transition', here !== undefined && 'hover:bg-white/5')}
                      >
                        <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-muted">{i + 1}</span>
                        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-lg text-lg font-black text-white/30" style={{ background: `linear-gradient(160deg, hsl(${hue} 45% 30%), hsl(${(hue + 40) % 360} 45% 14%))` }}>
                          {g.gameName.trim().charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{g.gameName}</span>
                          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-white/8">
                            <span className="block h-full rounded-full bg-accent/80" style={{ width: `${Math.max(3, (g.playtimeSeconds / topMax) * 100)}%` }} />
                          </span>
                          <span className="mt-1 block truncate text-xs text-muted">
                            {g.lastPlayedAt ? `Last played ${formatAgo(g.lastPlayedAt)}` : 'Not played lately'}
                            {here !== undefined && ' · you have it too'}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{formatPlaytime(g.playtimeSeconds)}</span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Recently played</h2>
            {!stats ? (
              <div className="shimmer mt-3 h-24 rounded-xl bg-white/[0.03]" />
            ) : stats.recent.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">Nothing lately.</p>
            ) : (
              <ul className="mt-3 space-y-2.5 text-sm">
                {stats.recent.map((g) => (
                  <li key={g.gameKey} className="flex items-baseline justify-between gap-3">
                    <span className="truncate">{g.gameName}</span>
                    <span className="shrink-0 text-xs text-muted">{formatAgo(g.lastPlayedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Badges</h2>
            <span className="text-xs tabular-nums text-muted">{stats ? `${earned.length} / ${BADGES.length} unlocked` : ''}</span>
          </div>
          {stats && earned.length === 0 ? (
            <p className="rounded-2xl border border-border bg-surface py-8 text-center text-sm text-muted">No badges yet.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {earned.map((b) => {
                const Icon = BADGE_ICONS[b.icon] ?? Award
                return (
                  <li key={b.id} title={b.description} className="flex flex-col items-center rounded-2xl border border-accent/40 bg-accent/10 p-4 text-center">
                    <span className="flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-white shadow-lg shadow-accent/30">
                      <Icon className="size-5" />
                    </span>
                    <p className="mt-3 text-sm font-semibold leading-tight">{b.name}</p>
                    <p className="mt-1 text-[11px] leading-snug text-muted">{b.description}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
