import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Clock, Gamepad2, LogIn, Trophy, UserMinus, UserPlus, UserRound, Users, X } from 'lucide-react'
import type { Friend, FriendsList, FriendStats } from '@shared/types'
import { Avatar } from '@/components/Avatar'
import { UserName } from '@/components/UserName'
import { Button } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import { formatAgo, formatPlaytime } from '@/lib/format'
import { useAccount } from '@/state/account'
import { useToast } from '@/state/toasts'

const REFRESH_MS = 30_000

export function statusLine(f: Friend, now = Date.now()): string {
  if (f.status.state === 'playing') {
    const mins = f.status.since ? Math.max(1, Math.round((now - f.status.since) / 60_000)) : null
    return `Playing ${f.status.gameName}${mins ? ` · ${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`}` : ''}`
  }
  if (f.status.state === 'online') return 'Online'
  return f.status.lastSeen ? `Last seen ${formatAgo(f.status.lastSeen)}` : 'Offline'
}

function FriendRow({ friend, selected, onSelect, index }: { friend: Friend; selected: boolean; onSelect: () => void; index: number }): React.JSX.Element {
  const playing = friend.status.state === 'playing'
  return (
    <button
      onClick={onSelect}
      style={{ '--i': index } as React.CSSProperties}
      className={cn(
        'animate-card-in group relative flex w-full items-center gap-4 overflow-clip rounded-2xl border bg-surface p-3.5 text-left transition duration-300 hover:-translate-y-0.5 [&>*]:relative',
        selected ? 'border-accent ring-2 ring-accent/40' : playing ? 'border-accent/40 hover:border-accent/60' : 'border-border hover:border-white/25'
      )}
    >
      {/* Their profile banner fills the row. */}
      <span aria-hidden className="profile-banner !absolute" data-banner={friend.style?.banner ?? 'default'} data-row-banner />
      <Avatar name={friend.username} src={friend.avatar} frame={friend.style?.frame} status={friend.status.state} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <UserName name={friend.username} style={friend.style} verified={friend.verified} admin={friend.admin} className="font-semibold" />
          <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-accent" title={`Level ${friend.level} (${friend.xp.toLocaleString()} XP)`}>
            Lv {friend.level}
          </span>
        </span>
        <span className={cn('flex items-center gap-1.5 truncate text-xs', playing ? 'text-accent' : friend.status.state === 'online' ? 'text-emerald-400' : 'text-muted')}>
          {playing && <Gamepad2 className="size-3.5 shrink-0" />}
          <span className="truncate">{statusLine(friend)}</span>
        </span>
      </span>
      <span className="hidden text-right text-xs text-muted sm:block">
        <span className="block font-semibold tabular-nums text-text">{formatPlaytime(friend.totalPlaytimeSeconds)}</span>
        {friend.gamesPlayed} game{friend.gamesPlayed === 1 ? '' : 's'}
      </span>
    </button>
  )
}

function FriendPanel({ friend, onRemoved }: { friend: Friend; onRemoved: () => void }): React.JSX.Element {
  const navigate = useNavigate()
  const toast = useToast()
  const [stats, setStats] = useState<FriendStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setStats(null)
    setError(null)
    window.vanity.friends.stats(friend.id).then((r) => (r.error !== undefined ? setError(r.error) : setStats(r.data)), () => {})
  }, [friend.id])

  const max = Math.max(1, ...(stats?.top ?? []).map((g) => g.playtimeSeconds))

  return (
    <aside key={friend.id} className="animate-rise-in sticky top-0 space-y-5 overflow-clip rounded-2xl border border-border bg-surface p-6 [&>*]:relative">
      {/* Their banner, fading out behind the top of the card. */}
      <div className="profile-banner !absolute h-36 [mask-image:linear-gradient(to_bottom,black,transparent)]" data-banner={friend.style?.banner ?? 'default'} />
      <button onClick={() => navigate(`/friends/${friend.id}`)} title={`Open ${friend.username}'s profile`} className="flex w-full items-center gap-4 rounded-xl text-left transition hover:brightness-110">
        <Avatar name={friend.username} src={friend.avatar} frame={friend.style?.frame} size="lg" status={friend.status.state} />
        <span className="block min-w-0">
          <span className="block font-display text-2xl font-bold">
            <UserName name={friend.username} style={friend.style} verified={friend.verified} admin={friend.admin} badgeSize="md" />
          </span>
          <span className="block truncate text-sm text-muted">{statusLine(friend)}</span>
          <span className="mt-1 block text-xs font-semibold text-accent">
            Level {stats?.level ?? friend.level}
            <span className="font-normal text-muted">
              {' '}
              · {(stats?.xp ?? friend.xp).toLocaleString()} XP{stats ? ` · ${stats.badges.length} badge${stats.badges.length === 1 ? '' : 's'}` : ''}
            </span>
          </span>
        </span>
      </button>
      {(stats?.bio ?? friend.bio) && <p className="whitespace-pre-wrap break-words rounded-xl bg-surface-2 px-3.5 py-3 text-sm text-text/85">{stats?.bio ?? friend.bio}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <Clock className="size-3.5" /> Playtime
          </p>
          <p className="mt-1 text-lg font-bold">{formatPlaytime(stats?.totalPlaytimeSeconds ?? friend.totalPlaytimeSeconds)}</p>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <Gamepad2 className="size-3.5" /> Games
          </p>
          <p className="mt-1 text-lg font-bold">{stats?.gamesPlayed ?? friend.gamesPlayed}</p>
        </div>
      </div>

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Trophy className="size-4 text-muted" /> Most played
        </h3>
        {error && <p className="text-sm text-accent">{error}</p>}
        {!stats && !error && <div className="shimmer h-24 rounded-xl bg-surface-2" />}
        {stats?.top.length === 0 && <p className="text-sm text-muted">Nothing played yet.</p>}
        <ul className="space-y-2.5">
          {stats?.top.slice(0, 6).map((g, i) => (
            <li key={g.gameKey}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{g.gameName}</span>
                <span className="shrink-0 tabular-nums text-muted">{formatPlaytime(g.playtimeSeconds)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-r-[4px] bg-accent transition-[width] duration-700 ease-out" style={{ width: `${(g.playtimeSeconds / max) * 100}%`, transitionDelay: `${i * 60}ms` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {stats && stats.recent.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Recently played</h3>
          <ul className="space-y-1.5 text-sm">
            {stats.recent.map((g) => (
              <li key={g.gameKey} className="flex justify-between gap-3">
                <span className="truncate">{g.gameName}</span>
                <span className="shrink-0 text-xs text-muted">{formatAgo(g.lastPlayedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button variant="primary" className="w-full justify-center" onClick={() => navigate(`/friends/${friend.id}`)} data-view-profile>
        <UserRound className="size-4" /> View profile
      </Button>

      <button
        className="flex items-center gap-1.5 text-xs text-muted transition hover:text-accent"
        onClick={async () => {
          const r = await window.vanity.friends.remove(friend.id)
          if (r.error !== undefined) toast(r.error, 'error')
          else {
            toast(`Removed ${friend.username}`)
            onRemoved()
          }
        }}
      >
        <UserMinus className="size-3.5" /> Remove friend
      </button>
    </aside>
  )
}

export function FriendsPage(): React.JSX.Element {
  const account = useAccount()
  const navigate = useNavigate()
  const toast = useToast()
  const [list, setList] = useState<FriendsList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await window.vanity.friends.list()
    if (r.error !== undefined) setError(r.error)
    else {
      setError(null)
      setList(r.data)
    }
  }, [])

  useEffect(() => {
    if (!account?.username) return
    void load()
    const t = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(t)
  }, [account?.username, load])

  const groups = useMemo(() => {
    const f = list?.friends ?? []
    return [
      { title: 'Playing now', items: f.filter((x) => x.status.state === 'playing') },
      { title: 'Online', items: f.filter((x) => x.status.state === 'online') },
      { title: 'Offline', items: f.filter((x) => x.status.state === 'offline') }
    ].filter((g) => g.items.length)
  }, [list])

  const add = async (): Promise<void> => {
    const name = adding.trim()
    if (!name) return
    const r = await window.vanity.friends.add(name)
    if (r.error !== undefined) toast(r.error, 'error')
    else {
      toast(r.data === 'accepted' ? `You and ${name} are now friends` : `Friend request sent to ${name}`)
      setAdding('')
      void load()
    }
  }

  const act = async (fn: () => Promise<{ error?: string }>, ok: string): Promise<void> => {
    const r = await fn()
    if (r.error !== undefined) toast(r.error, 'error')
    else {
      toast(ok)
      void load()
    }
  }

  if (!account) return <div className="h-full" />

  if (!account.username) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-10 text-center">
        <div className="animate-pop-in mb-6 flex size-20 items-center justify-center rounded-3xl bg-gradient-to-br from-accent to-accent-2 shadow-2xl shadow-accent/30">
          <Users className="size-9 text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Play together</h1>
        <p className="mt-2 max-w-md text-muted">Sign in to your Vanity account to see your friends, what they're playing right now, and their stats.</p>
        <Button variant="primary" className="mt-7 h-11 px-6" onClick={() => navigate('/account')}>
          <LogIn className="size-4" /> Sign in or create an account
        </Button>
      </div>
    )
  }

  const selectedFriend = list?.friends.find((f) => f.id === selected) ?? null

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-10 pb-16 pt-12">
        <header className="flex flex-wrap items-end gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Friends</h1>
            <p className="mt-1 text-sm text-muted">
              {list ? `${list.friends.filter((f) => f.status.state !== 'offline').length} online · ${list.friends.length} total` : 'Loading…'}
            </p>
          </div>
          <form
            className="ml-auto flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void add()
            }}
          >
            <input
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              placeholder="Add a friend by username"
              spellCheck={false}
              className="h-10 w-64 rounded-xl border border-border bg-surface-2 px-4 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
            <Button type="submit" variant="primary" disabled={!adding.trim()}>
              <UserPlus className="size-4" /> Add
            </Button>
          </form>
        </header>

        {error && <p className="mt-6 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">{error}</p>}

        {list && (list.incoming.length > 0 || list.outgoing.length > 0) && (
          <section className="mt-8 space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Requests</h2>
            {list.incoming.map((r) => (
              <div key={r.id} className="animate-pop-in relative flex items-center gap-3 overflow-clip rounded-2xl border border-accent/40 bg-surface p-3 [&>*]:relative">
                <span aria-hidden className="profile-banner !absolute" data-banner={r.style?.banner ?? 'default'} />
                <Avatar name={r.username} src={r.avatar} frame={r.style?.frame} size="sm" />
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                  <UserName name={r.username} style={r.style} verified={r.verified} admin={r.admin} className="font-bold" /> <span className="shrink-0">wants to be friends</span>
                </span>
                <Button variant="primary" onClick={() => act(() => window.vanity.friends.accept(r.id), `You and ${r.username} are now friends`)}>
                  <Check className="size-4" /> Accept
                </Button>
                <Button variant="ghost" onClick={() => act(() => window.vanity.friends.decline(r.id), 'Request declined')}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            {list.outgoing.map((r) => (
              <div key={r.id} className="relative flex items-center gap-3 overflow-clip rounded-2xl border border-border bg-surface p-3 [&>*]:relative">
                <span aria-hidden className="profile-banner !absolute opacity-60" data-banner={r.style?.banner ?? 'default'} />
                <Avatar name={r.username} src={r.avatar} frame={r.style?.frame} size="sm" />
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted">
                  <span className="shrink-0">Waiting for</span> <UserName name={r.username} style={r.style} verified={r.verified} admin={r.admin} className="font-bold text-text" /> <span className="shrink-0">to accept</span>
                </span>
                <Button variant="ghost" onClick={() => act(() => window.vanity.friends.decline(r.id), 'Request cancelled')}>
                  Cancel
                </Button>
              </div>
            ))}
          </section>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
          <div className="space-y-7">
            {list && list.friends.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted">
                No friends yet. Add someone by their Vanity username above.
              </div>
            )}
            {!list && !error && Array.from({ length: 3 }, (_, i) => <div key={i} className="shimmer h-[68px] rounded-2xl bg-surface" />)}
            {groups.map((g) => (
              <section key={g.title} className="space-y-2.5">
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
                  {g.title} <span className="font-normal">· {g.items.length}</span>
                </h2>
                {g.items.map((f, i) => (
                  <FriendRow key={f.id} friend={f} index={i} selected={f.id === selected} onSelect={() => setSelected(f.id === selected ? null : f.id)} />
                ))}
              </section>
            ))}
          </div>
          <div>
            {selectedFriend ? (
              <FriendPanel friend={selectedFriend} onRemoved={() => {
                setSelected(null)
                void load()
              }} />
            ) : (
              list && list.friends.length > 0 && <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">Pick a friend to see their stats.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
