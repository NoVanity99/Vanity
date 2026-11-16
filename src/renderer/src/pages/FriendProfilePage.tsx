import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Award, CalendarDays, Clock, ExternalLink, Flame, Gamepad2, Heart, MessageCircle, Rocket, Star, Trophy, UserCheck, Users, UserPlus } from 'lucide-react'
import { BADGES, levelFor } from '@shared/progress'
import { PLAY_STATUS_LABELS, type Friend, type FriendGameStat, type FriendStats, type PlayStatus } from '@shared/types'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Dialog'
import { ProfileTitle, UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { formatAgo, formatPlaytime } from '@/lib/format'
import { mediaUrl, nameHue } from '@/lib/media'
import { useToast } from '@/state/toasts'
import { useAccount } from '@/state/account'
import { openChat } from '@/state/chats'
import { useLibrary } from '@/state/library'
import { statusLine } from './FriendsPage'
import { BADGE_ICONS } from './ProfilePage'

const REFRESH_MS = 30_000
/** Matches a friend's game to one in your library by its name, ignoring capitals and punctuation. */
const plain = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '')
const dateOf = (at: number | null | undefined): string => (at ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown')

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

/** A game's cover: yours if you have the game, otherwise one looked up by its name; a coloured tile until (or unless) one is found. */
function Cover({ name, src, className }: { name: string; src: string | null | undefined; className?: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  // Steam's tall cover doesn't exist for every game: its wide store picture is tried next.
  const [wide, setWide] = useState(false)
  useEffect(() => {
    setFailed(false)
    setWide(false)
  }, [src])
  const hue = nameHue(name)
  const steam = /\/steam\/apps\/(\d+)\/library_600x900\.jpg$/.exec(src ?? '')?.[1]
  const shown = wide && steam ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${steam}/header.jpg` : src
  return (
    <span className={cn('relative block shrink-0 overflow-hidden rounded-lg', className)} style={{ background: `linear-gradient(160deg, hsl(${hue} 45% 30%), hsl(${(hue + 40) % 360} 45% 14%))` }} data-cover={shown && !failed ? 'image' : 'none'}>
      {shown && !failed ? (
        <img src={shown} alt="" loading="lazy" draggable={false} className="size-full object-cover" onError={() => (steam && !wide ? setWide(true) : setFailed(true))} />
      ) : (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center text-lg font-black text-white/30">
          {name.trim().charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  )
}

/** Someone who isn't your friend, as the profile page needs them (no online status: that's for friends). */
function strangerFrom(id: string, s: FriendStats): Friend {
  return {
    id,
    username: s.username,
    avatar: s.avatar,
    style: s.style,
    verified: s.verified,
    admin: s.admin,
    bio: s.bio,
    unread: 0,
    lastMessage: null,
    status: { state: 'offline', gameName: null, since: null, lastSeen: null },
    totalPlaytimeSeconds: s.totalPlaytimeSeconds,
    gamesPlayed: s.gamesPlayed,
    topGame: s.top[0]?.gameName ?? null,
    level: s.level,
    xp: s.xp,
    voice: null
  }
}

/** A player's profile (a friend's, or anyone who shows theirs): their look, level, bio, what they play, how you compare. */
export function FriendProfilePage(): React.JSX.Element {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const account = useAccount()
  const { library } = useLibrary()
  const [friend, setFriend] = useState<Friend | null>(null)
  const [stats, setStats] = useState<FriendStats | null>(null)
  const [isFriend, setIsFriend] = useState(true)
  const [requested, setRequested] = useState<'sent' | 'incoming' | null>(null)
  const [adding, setAdding] = useState(false)
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [covers, setCovers] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (!account?.username) return
    let cancelled = false
    setFriend(null)
    setStats(null)
    setError(null)
    setCovers({})
    const load = async (): Promise<void> => {
      const [list, s] = await Promise.all([window.vanity.friends.list(), window.vanity.friends.stats(id)]).catch(() => [null, null] as const)
      if (cancelled) return
      if (!list || !s) return setError("Couldn't reach Vanity's server. Check your connection and try again.")
      if (list.error !== undefined) return setError(list.error)
      const found = list.data.friends.find((f) => f.id === id) ?? null
      if (s.error !== undefined && !found) return setError(s.error)
      // Not a friend: the profile comes from their public stats (if they show them to everyone).
      const shown = found ?? (s.data ? strangerFrom(id, s.data) : null)
      if (!shown) return setError("That player couldn't be found.")
      setFriend(shown)
      setIsFriend(!!found)
      setRequested(list.data.outgoing.some((r) => r.id === id) ? 'sent' : list.data.incoming.some((r) => r.id === id) ? 'incoming' : null)
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

  // Your own copies of their games: for their covers, to open from here, and to compare playtime.
  const mine = useMemo(() => new Map(library.map((g) => [plain(g.name), g])), [library])

  // Covers for the games you don't have, looked up by name (and remembered by Vanity).
  const wanted = useMemo(() => {
    const names = new Set<string>()
    for (const g of [...(stats?.top ?? []), ...(stats?.recent ?? []), ...(stats?.favorites ?? []), ...(stats?.playing ?? [])]) if (!mine.get(plain(g.gameName))?.coverPath) names.add(g.gameName)
    return [...names].sort()
  }, [stats, mine])
  const wantedKey = wanted.join('\n')
  useEffect(() => {
    if (!wanted.length) return
    let cancelled = false
    window.vanity.games.coversByName(wanted).then(
      (found) => !cancelled && setCovers((prev) => ({ ...prev, ...found })),
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [wantedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const coverOf = (name: string): string | null => mediaUrl(mine.get(plain(name))?.coverPath ?? null) ?? covers[name] ?? null

  // An old "open the chat" link (?chat=1): opens the chat pop-up.
  const toChat = params.get('chat') === '1'
  useEffect(() => {
    if (toChat && friend) openChat(friend)
  }, [toChat, friend?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const back = (
    <button onClick={() => navigate('/friends')} className="flex items-center gap-2 text-sm text-muted transition hover:text-text">
      <ArrowLeft className="size-4" /> Friends
    </button>
  )

  if (!account?.signedIn || !account.username || error || !friend) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 px-10 pb-16 pt-12 max-md:px-4 max-md:pt-14">
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
  const earned = BADGES.filter((b) => stats?.badges.includes(b.id)).sort((a, b) => (stats?.badgeTimes?.[b.id] ?? 0) - (stats?.badgeTimes?.[a.id] ?? 0))
  const top = stats?.top ?? []
  const topMax = top[0]?.playtimeSeconds ?? 1
  const shared = top.filter((g) => mine.has(plain(g.gameName)))
  const playing = friend.status.state === 'playing'
  const nowPlaying = playing && friend.status.gameName ? friend.status.gameName : null
  const totalChat = (stats?.messages?.sent ?? 0) + (stats?.messages?.received ?? 0)

  const facts: [string, string][] = stats
    ? [
        ['Joined Vanity', dateOf(stats.memberSince)],
        ...(isFriend ? [['Friends since', dateOf(stats.friendsSince)] as [string, string]] : []),
        ['Friends', `${(stats.friendCount ?? 0).toLocaleString()}${stats.mutualFriends ? ` · ${stats.mutualFriends} you both know` : ''}`],
        ['Games finished', (stats.finished ?? 0).toLocaleString()],
        ['Average rating', stats.averageRating ? `${stats.averageRating} / 5 over ${stats.ratedGames} game${stats.ratedGames === 1 ? '' : 's'}` : 'No ratings yet'],
        ['Best streak', `${stats.bestStreak ?? 0} day${stats.bestStreak === 1 ? '' : 's'} in a row`],
        ...(isFriend ? [['Messages between you', totalChat ? `${totalChat.toLocaleString()} since ${dateOf(stats.messages.firstAt)}` : 'None yet'] as [string, string]] : [])
      ]
    : []

  const gameRow = (g: FriendGameStat, rank: number | null): React.JSX.Element => {
    const here = mine.get(plain(g.gameName))
    const status = g.playStatus && g.playStatus in PLAY_STATUS_LABELS ? PLAY_STATUS_LABELS[g.playStatus as PlayStatus] : null
    return (
      <li key={g.gameKey}>
        <button
          disabled={!here}
          onClick={() => here && navigate(`/game/${here.id}`)}
          title={here ? `Open ${g.gameName} in your library` : `${g.gameName} isn't in your library`}
          className={cn('flex w-full items-center gap-3 rounded-xl p-2 text-left transition', here && 'hover:bg-white/5')}
        >
          {rank !== null && <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-muted">{rank}</span>}
          <Cover name={g.gameName} src={coverOf(g.gameName)} className="h-[72px] w-[54px] shadow-lg shadow-black/40 ring-1 ring-white/10" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{g.gameName}</span>
              {g.favorite && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="One of their favourites" />}
              {status && <span className="shrink-0 rounded-full bg-white/8 px-1.5 py-px text-[10px] font-semibold text-muted">{status}</span>}
            </span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/8">
              <span className="block h-full rounded-full bg-accent/80" style={{ width: `${Math.max(3, (g.playtimeSeconds / topMax) * 100)}%` }} />
            </span>
            <span className="mt-1 block truncate text-xs text-muted">
              {g.launches ? `${g.launches.toLocaleString()} launch${g.launches === 1 ? '' : 'es'} · ` : ''}
              {g.lastPlayedAt ? `last played ${formatAgo(g.lastPlayedAt)}` : 'not played lately'}
              {g.rating ? ` · rated ${g.rating}/5` : ''}
            </span>
            {here && (
              <span className="block truncate text-xs text-emerald-400/90">
                You: {here.playtimeSeconds > 0 ? formatPlaytime(here.playtimeSeconds) : 'not played yet'}
                {here.playtimeSeconds > g.playtimeSeconds ? ' (ahead)' : ''}
              </span>
            )}
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">{formatPlaytime(g.playtimeSeconds)}</span>
        </button>
      </li>
    )
  }

  const shelf = (title: string, icon: typeof Clock, games: FriendGameStat[]): React.JSX.Element | null =>
    games.length === 0 ? null : (
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted">
          {(() => {
            const Icon = icon
            return <Icon className="size-4" />
          })()}
          {title}
        </h2>
        <ul className="mt-4 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {games.map((g) => {
            const here = mine.get(plain(g.gameName))
            return (
              <li key={g.gameKey} className="w-[92px] shrink-0">
                <button disabled={!here} onClick={() => here && navigate(`/game/${here.id}`)} title={here ? `Open ${g.gameName} in your library` : g.gameName} className={cn('block w-full text-left transition', here && 'hover:-translate-y-0.5')}>
                  <Cover name={g.gameName} src={coverOf(g.gameName)} className="aspect-[3/4] w-full rounded-xl ring-1 ring-white/10" />
                  <span className="mt-1.5 block truncate text-xs font-medium">{g.gameName}</span>
                  <span className="block truncate text-[11px] text-muted">{formatPlaytime(g.playtimeSeconds)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    )

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden" data-friend-profile>
      <div className="stagger mx-auto max-w-6xl space-y-6 px-10 pb-16 pt-12 max-md:px-4 max-md:pt-14">
        {back}

        <section className="relative overflow-clip rounded-3xl border border-border bg-surface p-7 max-md:p-5">
          <div className="profile-banner" data-banner={style?.banner ?? 'default'} data-fx={style?.effect ?? 'none'} />
          <div className="relative flex flex-wrap items-center gap-6">
            <Avatar name={friend.username} src={stats?.avatar ?? friend.avatar} frame={style?.frame} aura={style?.aura} size="xl" status={friend.status.state} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">{level.title}</p>
              <h1 className="font-display text-4xl font-black tracking-tight max-md:text-3xl">
                <UserName name={friend.username} style={style} verified={friend.verified} admin={friend.admin} badgeSize="lg" />
              </h1>
              <ProfileTitle title={style?.title} className="mt-1.5" />
              {bio && <p className="mt-1.5 max-w-xl whitespace-pre-wrap break-words text-sm text-text/85">{bio}</p>}
              {isFriend && (
                <p className={cn('mt-1.5 flex items-center gap-1.5 text-sm', playing ? 'text-accent' : friend.status.state === 'online' ? 'text-emerald-400' : 'text-muted')}>
                  {playing && <Gamepad2 className="size-4 shrink-0" />}
                  {statusLine(friend)}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {isFriend ? (
                  <Button variant="primary" onClick={() => openChat(friend)} data-open-chat>
                    <MessageCircle className="size-4" /> Message
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={adding || requested === 'sent'}
                    onClick={async () => {
                      setAdding(true)
                      const r = await window.vanity.friends.add(friend.username).catch(() => null)
                      setAdding(false)
                      if (!r || r.error !== undefined) return toast(r?.error ?? "Couldn't send the request.", 'error')
                      if (r.data === 'accepted') {
                        setIsFriend(true)
                        toast(`You and ${friend.username} are now friends`)
                      } else {
                        setRequested('sent')
                        toast(`Friend request sent to ${friend.username}`)
                      }
                    }}
                    data-add-friend-profile
                  >
                    <UserPlus className="size-4" /> {requested === 'sent' ? 'Request sent' : requested === 'incoming' ? 'Accept friend request' : 'Add friend'}
                  </Button>
                )}
                {stats?.steam && (
                  <a href={stats.steam.profileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-border bg-black/25 px-3.5 py-2 text-sm font-medium backdrop-blur transition hover:border-white/25">
                    Steam: {stats.steam.name} <ExternalLink className="size-3.5 text-muted" />
                  </a>
                )}
              </div>
            </div>
            {nowPlaying && (
              <div className="flex items-center gap-3 rounded-2xl border border-accent/40 bg-black/35 p-2.5 pr-4 backdrop-blur" data-now-playing>
                <Cover name={nowPlaying} src={coverOf(nowPlaying)} className="h-20 w-[60px] ring-1 ring-white/15" />
                <span className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-accent">Playing now</span>
                  <span className="block max-w-[11rem] truncate text-sm font-semibold">{nowPlaying}</span>
                  {friend.status.since && <span className="block text-xs text-muted">since {new Date(friend.status.since).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>}
                </span>
              </div>
            )}
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

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4" data-friend-tiles>
          <Tile icon={Clock} label="Playtime" value={formatPlaytime(stats?.totalPlaytimeSeconds ?? friend.totalPlaytimeSeconds)} hint={stats?.daysPlayed ? `on ${stats.daysPlayed.toLocaleString()} day${stats.daysPlayed === 1 ? '' : 's'}` : undefined} />
          <Tile icon={Gamepad2} label="Games played" value={(stats?.gamesPlayed ?? friend.gamesPlayed).toLocaleString()} hint={stats ? `${(stats.finished ?? 0).toLocaleString()} finished` : undefined} />
          <Tile icon={Rocket} label="Launches" value={stats ? (stats.launches ?? 0).toLocaleString() : '…'} hint="games started from Vanity" />
          <Tile icon={Flame} label="Streak" value={stats ? `${stats.currentStreak ?? 0} day${stats.currentStreak === 1 ? '' : 's'}` : '…'} hint={stats ? `best: ${stats.bestStreak ?? 0}` : undefined} />
          <Tile icon={Trophy} label="Favourite game" value={top[0]?.gameName ?? friend.topGame ?? 'None yet'} hint={top[0] ? formatPlaytime(top[0].playtimeSeconds) : undefined} />
          <Tile icon={Users} label="In common" value={stats ? `${shared.length} game${shared.length === 1 ? '' : 's'}` : '…'} hint="of their most played, in your library" />
          <Tile icon={Award} label="Badges" value={stats ? `${earned.length} / ${BADGES.length}` : '…'} hint={earned[0] ? `latest: ${earned[0].name}` : undefined} />
          <Tile icon={UserCheck} label="Friends" value={stats ? (stats.friendCount ?? 0).toLocaleString() : '…'} hint={stats?.mutualFriends ? `${stats.mutualFriends} you both know` : undefined} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="space-y-6">
            {shelf('Playing these days', Gamepad2, stats?.playing ?? [])}
            <section className="rounded-2xl border border-border bg-surface p-5" data-most-played>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Most played</h2>
              {!stats ? (
                <div className="shimmer mt-3 h-40 rounded-xl bg-white/[0.03]" />
              ) : top.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted">{friend.username} hasn't shared any playtime yet.</p>
              ) : (
                <ol className="mt-3 space-y-1">{top.map((g, i) => gameRow(g, i + 1))}</ol>
              )}
            </section>
            {shelf('Their favourites', Heart, stats?.favorites ?? [])}
          </div>

          <div className="space-y-6">
            <section className="rounded-2xl border border-border bg-surface p-5" data-friend-facts>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted">
                <CalendarDays className="size-4" /> About {friend.username}
              </h2>
              {!stats ? (
                <div className="shimmer mt-3 h-32 rounded-xl bg-white/[0.03]" />
              ) : (
                <dl className="mt-3 space-y-2.5 text-sm">
                  {facts.map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-4">
                      <dt className="shrink-0 text-muted">{label}</dt>
                      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
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
                    <li key={g.gameKey} className="flex items-center gap-3">
                      <Cover name={g.gameName} src={coverOf(g.gameName)} className="h-12 w-9 ring-1 ring-white/10" />
                      <span className="min-w-0 flex-1 truncate">{g.gameName}</span>
                      <span className="shrink-0 text-xs text-muted">{formatAgo(g.lastPlayedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Badges</h2>
            <span className="text-xs tabular-nums text-muted">{stats ? `${earned.length} / ${BADGES.length} unlocked` : ''}</span>
          </div>
          {stats && earned.length === 0 ? (
            <p className="rounded-2xl border border-border bg-surface py-8 text-center text-sm text-muted">No badges yet.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {earned.map((b) => {
                const Icon = BADGE_ICONS[b.icon] ?? Award
                const at = stats?.badgeTimes?.[b.id]
                return (
                  <li key={b.id} title={b.description} className="flex flex-col items-center rounded-2xl border border-accent/40 bg-accent/10 p-4 text-center">
                    <span className="flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-white shadow-lg shadow-accent/30">
                      <Icon className="size-5" />
                    </span>
                    <p className="mt-3 text-sm font-semibold leading-tight">{b.name}</p>
                    <p className="mt-1 text-[11px] leading-snug text-muted">{b.description}</p>
                    {at ? <p className="mt-1.5 text-[10px] text-muted/80">{dateOf(at)}</p> : null}
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
