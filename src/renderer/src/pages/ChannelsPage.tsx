import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Compass, Hash, KeyRound, Loader2, Plus, Search, Settings, UserPlus, Users, X } from 'lucide-react'
import { can, ROLES, type Category, type Channel, type CommunityCard, type CommunityDetail, type CommunityMember } from '@shared/communities'
import type { ProfileStyle } from '@shared/profileStyle'
import { Avatar } from '@/components/Avatar'
import { Button, Dialog } from '@/components/Dialog'
import { UserName } from '@/components/UserName'
import { ChannelChat } from '@/components/channels/ChannelChat'
import { CommunitySettings } from '@/components/channels/CommunitySettings'
import { CreateCommunity } from '@/components/channels/CreateCommunity'
import { CardSkeleton, CommunityCardView, CommunityIcon, VISIBILITY_ICON } from '@/components/channels/bits'
import { cn } from '@/lib/cn'
import { useIsPhone } from '@/lib/platform'
import { useAccount } from '@/state/account'
import { api, lastPlace, refreshCommunities, rememberPlace, useCommunity, useMembers, useMyCommunities } from '@/state/communities'
import { usePulse } from '@/state/pulse'
import { useToast } from '@/state/toasts'

// The Channels tab. In code a "community" is what people see as a Channel, and a "channel" is one
// of the rooms inside it (see src/shared/communities.ts).

const field = 'h-10 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15'
const styleOf = (s: unknown): Partial<ProfileStyle> | undefined => (s && typeof s === 'object' ? (s as Partial<ProfileStyle>) : undefined)

/** Vanity reopens where you last were, once per run: after that, Home really is Home. */
let restored = false

/** Which categories you've folded shut, kept on this device. */
const COLLAPSED_KEY = 'vanity.channels.collapsed'
function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function ChannelsPage(): React.JSX.Element {
  const { communityId = null, channelId = null } = useParams()
  const navigate = useNavigate()
  const account = useAccount()
  const mine = useMyCommunities()
  const phone = useIsPhone()
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)

  // Back where you were, on any PC (the place is kept on the server).
  useEffect(() => {
    if (restored || mine === null) return
    restored = true
    const last = lastPlace()
    if (!communityId && last.communityId && mine.some((c) => c.id === last.communityId)) {
      navigate(`/channels/${last.communityId}${last.channelId && !phone ? `/${last.channelId}` : ''}`, { replace: true })
    }
  }, [mine]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (restored) rememberPlace(communityId, channelId)
  }, [communityId, channelId])

  if (!account?.signedIn) {
    return (
      <div className="flex h-full items-center justify-center p-8 pt-16 text-center">
        <p className="max-w-sm text-sm text-muted">Sign in to your Vanity account to use Channels.</p>
      </div>
    )
  }

  // On a phone, the strip of icons shows with the lists and steps aside for a chat.
  const showStrip = !phone || !channelId
  return (
    <div className="flex h-full pt-9" data-channels-page>
      {showStrip && (
        <nav aria-label="Your Channels" className="thin-scroll flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-border bg-black/25 py-3 max-md:w-16" data-community-strip>
          <div className="strip-item w-full" data-active={!communityId}>
            <button onClick={() => navigate('/channels')} title="Home: your Channels and Discover" aria-label="Channels home" className={cn('strip-icon flex size-12 items-center justify-center transition-colors', !communityId ? 'bg-accent text-white' : 'bg-surface-2 text-muted hover:bg-accent hover:text-white')} data-strip-home>
              <Compass className="size-6" />
            </button>
          </div>
          <span className="h-0.5 w-8 shrink-0 rounded-full bg-border" />
          {mine?.map((c) => (
            <div key={c.id} className="strip-item w-full" data-active={c.id === communityId} data-unread={c.unread > 0 && c.id !== communityId}>
              <button onClick={() => navigate(`/channels/${c.id}`)} title={c.name} aria-label={c.name} className="relative" data-strip-community={c.name}>
                <CommunityIcon name={c.name} icon={c.icon} className="strip-icon size-12 text-sm" />
                {c.unread > 0 && c.id !== communityId && (
                  <span className="absolute -bottom-1 -right-1 min-w-5 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-5 text-white ring-[3px] ring-bg" data-strip-unread>
                    {c.unread > 99 ? '99+' : c.unread}
                  </span>
                )}
              </button>
            </div>
          ))}
          <div className="strip-item w-full">
            <button onClick={() => setCreating(true)} title="Create a Channel" aria-label="Create a Channel" className="strip-icon flex size-12 items-center justify-center bg-surface-2 text-emerald-400 transition-colors hover:bg-emerald-500 hover:text-white" data-strip-create>
              <Plus className="size-6" />
            </button>
          </div>
        </nav>
      )}

      {communityId ? (
        <CommunityView key={communityId} id={communityId} channelId={channelId} phone={phone} />
      ) : (
        <Home mine={mine} onCreate={() => setCreating(true)} onJoinCode={() => setJoining(true)} />
      )}

      {creating && (
        <CreateCommunity
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false)
            navigate(`/channels/${c.id}`)
          }}
        />
      )}
      {joining && <JoinWithCode onClose={() => setJoining(false)} onJoined={(c) => (setJoining(false), navigate(`/channels/${c.id}`))} />}
    </div>
  )
}

// ---- home: My Channels and Discover ---------------------------------------------------

function Home({ mine, onCreate, onJoinCode }: { mine: CommunityCard[] | null; onCreate: () => void; onJoinCode: () => void }): React.JSX.Element {
  const navigate = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState<'mine' | 'discover'>('mine')
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<CommunityCard[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [asking, setAsking] = useState<CommunityCard | null>(null)
  const [note, setNote] = useState('')
  const asked = useRef(0)

  const search = (q: string): Promise<void> => {
    const turn = ++asked.current
    // Only what the app lets through in an address (see src/shared/apiPaths.ts).
    const clean = encodeURIComponent(q.trim().replace(/[!'()*]/g, ' '))
    return api<{ communities: CommunityCard[] }>('GET', `/discover${clean ? `?q=${clean}` : ''}`).then(
      (r) => {
        if (turn !== asked.current) return
        setFound(r.communities)
        setFailed(null)
      },
      (e: unknown) => {
        if (turn === asked.current) setFailed(e instanceof Error ? e.message : "Couldn't load Discover.")
      }
    )
  }
  // Discover is looked up as you type (after a short pause), and again now and then while open.
  useEffect(() => {
    if (tab !== 'discover') return
    const wait = setTimeout(() => void search(query), found === null ? 0 : 250)
    const timer = setInterval(() => !document.hidden && void search(query), 15_000)
    return () => {
      clearTimeout(wait)
      clearInterval(timer)
    }
  }, [tab, query]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (c: CommunityCard, what: 'join' | 'cancel'): Promise<void> => {
    setBusy(c.id)
    try {
      if (what === 'join') {
        await api('POST', `/${c.id}/join`)
        await refreshCommunities()
        toast(`You joined ${c.name}`)
        navigate(`/channels/${c.id}`)
      } else {
        await api('DELETE', `/${c.id}/request`)
        toast('Request taken back')
        await search(query)
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work.', 'error')
      void search(query)
    } finally {
      setBusy(null)
    }
  }
  const ask = async (): Promise<void> => {
    if (!asking) return
    setBusy(asking.id)
    try {
      await api('POST', `/${asking.id}/request`, { message: note })
      toast(`Asked to join ${asking.name}`)
      setAsking(null)
      setNote('')
      await search(query)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const tabButton = (id: 'mine' | 'discover', label: string, count?: number): React.JSX.Element => (
    <button role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('relative px-1 pb-3 text-sm font-bold transition', tab === id ? 'text-text' : 'text-muted hover:text-text')} data-channels-tab={id}>
      {label}
      {count !== undefined && <span className="ml-2 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] tabular-nums">{count}</span>}
      <span className={cn('absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent transition-transform duration-200', tab === id ? 'scale-x-100' : 'scale-x-0')} />
    </button>
  )
  const grid = 'grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4'

  return (
    <div className="thin-scroll min-w-0 flex-1 overflow-y-auto" data-channels-home={tab}>
      <div className="mx-auto max-w-6xl space-y-6 px-8 py-6 max-md:px-4">
        <header className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold tracking-tight">Channels</h1>
            <p className="mt-1 text-sm text-muted">Places to hang out, each with its own channels to talk in.</p>
          </div>
          <Button onClick={onJoinCode} data-join-with-code>
            <KeyRound className="size-4" /> Join with a code
          </Button>
          <Button variant="primary" onClick={onCreate} data-create-channel>
            <Plus className="size-4" /> Create Channel
          </Button>
        </header>

        <div role="tablist" className="flex gap-6 border-b border-border">
          {tabButton('mine', 'My Channels', mine?.length)}
          {tabButton('discover', 'Discover')}
        </div>

        {tab === 'mine' && (
          <div key="mine" className="pane-in">
            {mine === null ? (
              <div className={grid}>{[0, 1, 2].map((i) => <CardSkeleton key={i} />)}</div>
            ) : mine.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border px-6 py-16 text-center" data-channels-empty>
                <span className="flex size-16 items-center justify-center rounded-3xl bg-accent/15 text-accent">
                  <Compass className="size-8" />
                </span>
                <div>
                  <p className="font-display text-xl font-bold">You&apos;re not in any Channels yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Make one for your friends, or look around Discover for one to join.</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" onClick={onCreate}>
                    <Plus className="size-4" /> Create Channel
                  </Button>
                  <Button onClick={() => setTab('discover')}>
                    <Search className="size-4" /> Browse Discover
                  </Button>
                </div>
              </div>
            ) : (
              <div className={grid} data-my-channels>
                {mine.map((c) => (
                  <CommunityCardView key={c.id} c={c} onOpen={() => navigate(`/channels/${c.id}`)} action={<Button className="w-full" onClick={() => navigate(`/channels/${c.id}`)} data-open-community>Open</Button>} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'discover' && (
          <div key="discover" className="pane-in space-y-5">
            <label className="relative block max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input className={cn(field, 'h-11 pl-10 pr-9')} value={query} onChange={(e) => setQuery(e.target.value.slice(0, 60))} placeholder="Search Channels by name or description" aria-label="Search Channels" data-discover-search />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:text-text">
                  <X className="size-4" />
                </button>
              )}
            </label>
            {found === null ? (
              failed ? (
                <p className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted">{failed}</p>
              ) : (
                <div className={grid}>{[0, 1, 2, 3, 4, 5].map((i) => <CardSkeleton key={i} />)}</div>
              )
            ) : found.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted" data-discover-empty>
                {query.trim() ? `Nothing matches “${query.trim()}”.` : 'No Channels to discover yet. Be the first to make one.'}
              </p>
            ) : (
              <div className={grid} data-discover-grid>
                {found.map((c) => (
                  <CommunityCardView
                    key={c.id}
                    c={c}
                    onOpen={c.role ? () => navigate(`/channels/${c.id}`) : undefined}
                    action={
                      c.role ? (
                        <Button className="w-full" onClick={() => navigate(`/channels/${c.id}`)} data-open-community>Open</Button>
                      ) : c.visibility === 'open' ? (
                        <Button variant="primary" className="w-full" disabled={busy === c.id} onClick={() => void act(c, 'join')} data-join>
                          {busy === c.id ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />} Join
                        </Button>
                      ) : c.requested ? (
                        <Button className="w-full" disabled={busy === c.id} onClick={() => void act(c, 'cancel')} title="Take your request back" data-requested>
                          Requested
                        </Button>
                      ) : (
                        <Button className="w-full" disabled={busy === c.id} onClick={() => (setNote(''), setAsking(c))} data-ask-to-join>
                          Ask to join
                        </Button>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {asking && (
        <Dialog
          title={`Ask to join ${asking.name}`}
          description="It's private: someone who runs it decides who comes in. You can add a short note."
          onClose={() => setAsking(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
              <Button variant="primary" disabled={busy !== null} onClick={() => void ask()} data-send-request>Send request</Button>
            </>
          }
        >
          <div className="p-6">
            <textarea className={cn(field, 'h-auto resize-none py-2.5')} rows={3} autoFocus value={note} onChange={(e) => setNote([...e.target.value].slice(0, 200).join(''))} placeholder="Hi! I'd like to join because… (optional)" aria-label="A note for them" data-request-note />
          </div>
        </Dialog>
      )}
    </div>
  )
}

/** Type an invite code, see what it is for, then join. This is the only way into a Hidden one. */
function JoinWithCode({ onClose, onJoined }: { onClose: () => void; onJoined: (c: CommunityDetail) => void }): React.JSX.Element {
  const toast = useToast()
  const [code, setCode] = useState('')
  const [card, setCard] = useState<CommunityCard | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 20)

  const look = async (): Promise<void> => {
    if (clean.length < 4) return
    setBusy(true)
    setProblem(null)
    try {
      setCard((await api<{ community: CommunityCard }>('GET', `/invites/${clean}`)).community)
    } catch (e) {
      setCard(null)
      setProblem(e instanceof Error ? e.message : "That invite doesn't work.")
    } finally {
      setBusy(false)
    }
  }
  const join = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await api<{ community: CommunityDetail }>('POST', `/invites/${clean}/join`)
      await refreshCommunities()
      toast(`Welcome to ${r.community.name}`)
      onJoined(r.community)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Join with a code"
      description="Got an invite code from a friend? Enter it here."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {card ? (
            <Button variant="primary" disabled={busy} onClick={() => void join()} data-invite-join>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />} {card.role ? 'Open' : 'Join'}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy || clean.length < 4} onClick={() => void look()} data-invite-look>
              {busy && <Loader2 className="size-4 animate-spin" />} Look it up
            </Button>
          )}
        </>
      }
    >
      <form
        className="space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault()
          void (card ? join() : look())
        }}
      >
        <input className={cn(field, 'h-12 text-center font-mono text-lg font-bold uppercase tracking-[0.3em]')} autoFocus value={clean} onChange={(e) => (setCode(e.target.value), setCard(null), setProblem(null))} placeholder="CODE" aria-label="Invite code" data-invite-code />
        {problem && <p className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent" data-invite-problem>{problem}</p>}
        {card && (
          <div className="pane-in" data-invite-preview>
            <CommunityCardView c={card} />
          </div>
        )}
      </form>
    </Dialog>
  )
}

// ---- one community: its channels, the chat, its people ---------------------------------

function CommunityView({ id, channelId, phone }: { id: string; channelId: string | null; phone: boolean }): React.JSX.Element {
  const navigate = useNavigate()
  const { community: c, error, refresh } = useCommunity(id)
  const myId = usePulse().myId ?? undefined
  const [settings, setSettings] = useState<null | 'main' | 'invites' | 'requests'>(null)
  // The member list: beside the chat on a PC (remembered), a panel you pull out on a phone.
  const [membersPc, setMembersPc] = useState(() => {
    try {
      return localStorage.getItem('vanity.channels.members') !== 'off'
    } catch {
      return true
    }
  })
  const [membersPhone, setMembersPhone] = useState(false)
  const showMembers = phone ? membersPhone : membersPc
  useEffect(() => setMembersPhone(false), [channelId, phone])
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const { members } = useMembers(id, showMembers)

  const channel = c?.channels.find((ch) => ch.id === channelId) ?? null
  // On a PC a community always opens on a channel: the one you asked for, else its first.
  const ordered = useMemo(() => (c ? inOrder(c) : []), [c])
  useEffect(() => {
    if (!c || phone || channel) return
    const first = ordered.flatMap((g) => g.channels)[0]
    if (first) navigate(`/channels/${id}/${first.id}`, { replace: true })
    else if (channelId) navigate(`/channels/${id}`, { replace: true })
  }, [c, channel, phone]) // eslint-disable-line react-hooks/exhaustive-deps
  // The channel you were in was deleted while you were on a phone: back to the list.
  useEffect(() => {
    if (c && phone && channelId && !channel) navigate(`/channels/${id}`, { replace: true })
  }, [c, channel, phone]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center p-8" data-community-state={error ? 'gone' : 'loading'}>
        {error ? (
          <div className="pane-in max-w-sm space-y-4 text-center">
            <p className="font-display text-xl font-bold">This Channel can&apos;t be opened</p>
            <p className="text-sm text-muted">{error}</p>
            <Button variant="primary" onClick={() => navigate('/channels')}>Back to Channels</Button>
          </div>
        ) : (
          <div className="flex w-full max-w-3xl gap-4">
            <div className="skeleton h-80 w-56 rounded-2xl max-md:hidden" />
            <div className="skeleton h-80 flex-1 rounded-2xl" />
          </div>
        )}
      </div>
    )
  }

  const role = c.role!
  const Vis = VISIBILITY_ICON[c.visibility]
  const toggle = (categoryId: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(categoryId)) next.add(categoryId)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next].slice(-300)))
      } catch {
        // Kept for this visit only.
      }
      return next
    })
  const toggleMembers = (): void => {
    if (phone) return setMembersPhone((on) => !on)
    setMembersPc((on) => {
      try {
        localStorage.setItem('vanity.channels.members', on ? 'off' : 'on')
      } catch {
        // Kept for this visit only.
      }
      return !on
    })
  }

  const channelRow = (ch: Channel): React.JSX.Element => {
    const active = ch.id === channelId
    const unread = !active && ch.unread > 0
    return (
      <button key={ch.id} onClick={() => navigate(`/channels/${id}/${ch.id}`)} className={cn('group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition', active ? 'bg-white/10 font-semibold text-text' : unread ? 'font-semibold text-text hover:bg-white/5' : 'text-muted hover:bg-white/5 hover:text-text')} data-channel={ch.name} data-active={active}>
        <Hash className={cn('size-4 shrink-0', active ? 'text-accent' : 'text-muted')} />
        <span className="min-w-0 flex-1 truncate">{ch.name}</span>
        {unread && <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-[10px] font-bold leading-5 text-white" data-channel-unread>{ch.unread > 99 ? '99+' : ch.unread}</span>}
      </button>
    )
  }

  const sidebar = (
    <aside className={cn('flex w-60 shrink-0 flex-col border-r border-border bg-surface/40', phone && 'w-auto min-w-0 flex-1 border-r-0')} data-community-sidebar={c.name}>
      <div className="relative h-28 shrink-0 overflow-hidden">
        <span className="profile-banner !inset-0 !h-full" data-banner={c.banner} />
        <span className="absolute inset-0 bg-gradient-to-t from-bg via-bg/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-2.5 p-3">
          <CommunityIcon name={c.name} icon={c.icon} className="size-11 rounded-xl text-sm shadow-lg ring-2 ring-white/15" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-base font-bold leading-tight" data-community-name>{c.name}</h2>
            <p className="flex items-center gap-1.5 text-[11px] text-white/70">
              <Vis className="size-3" /> {c.visibility === 'open' ? 'Open' : c.visibility === 'private' ? 'Private' : 'Hidden'} · {c.members.toLocaleString()} {c.members === 1 ? 'member' : 'members'}
            </p>
          </div>
          <button onClick={() => setSettings('main')} title="Channel settings" aria-label="Channel settings" className="relative rounded-lg bg-black/40 p-1.5 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white" data-open-settings>
            <Settings className="size-4" />
            {c.pendingRequests > 0 && can(role, 'approveRequests') && <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-amber-400 ring-2 ring-bg" />}
          </button>
        </div>
      </div>

      <div className="flex shrink-0 gap-1.5 px-2 pt-2">
        {can(role, 'invite') && (
          <button onClick={() => setSettings('invites')} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent/15 px-2 py-1.5 text-xs font-bold text-accent transition hover:bg-accent hover:text-white" data-invite-people>
            <UserPlus className="size-3.5" /> Invite people
          </button>
        )}
        {c.pendingRequests > 0 && can(role, 'approveRequests') && (
          <button onClick={() => setSettings('requests')} className="flex items-center gap-1.5 rounded-lg bg-amber-400/15 px-2 py-1.5 text-xs font-bold text-amber-300 transition hover:bg-amber-400 hover:text-black" data-pending-requests={c.pendingRequests}>
            {c.pendingRequests} waiting
          </button>
        )}
      </div>

      <div className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-2" data-channel-list>
        {ordered.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted">No channels yet.{can(role, 'manageChannels') ? ' Add one in settings.' : ''}</p>}
        {ordered.map((g) => {
          const shut = g.category ? collapsed.has(g.category.id) : false
          // A folded category still shows the channel you're in and any with something new.
          const rows = shut ? g.channels.filter((ch) => ch.id === channelId || ch.unread > 0) : g.channels
          return (
            <div key={g.category?.id ?? 'none'} data-category={g.category?.name ?? ''}>
              {g.category && (
                <button onClick={() => toggle(g.category!.id)} aria-expanded={!shut} className="flex w-full items-center gap-1 px-1 py-1 text-[11px] font-bold uppercase tracking-widest text-muted transition hover:text-text" data-category-toggle>
                  <ChevronDown className={cn('size-3 transition-transform duration-200', shut && '-rotate-90')} />
                  <span className="truncate">{g.category.name}</span>
                </button>
              )}
              <div className="space-y-0.5">{rows.map(channelRow)}</div>
            </div>
          )
        })}
      </div>
    </aside>
  )

  const memberList = (
    <aside className={cn('thin-scroll shrink-0 overflow-y-auto border-l border-border p-3', phone ? 'pane-in absolute inset-y-0 right-0 z-10 w-64 max-w-[85%] bg-bg shadow-2xl shadow-black' : 'w-56 bg-surface/40 max-lg:hidden')} data-member-list>
      {members === null ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-9 rounded-lg" />)}</div>
      ) : (
        ([['Online', members.filter((m) => m.online)], ['Offline', members.filter((m) => !m.online)]] as [string, CommunityMember[]][]).map(([label, list]) =>
          list.length === 0 ? null : (
            <section key={label} className="mb-4">
              <h3 className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-widest text-muted">{label} · {list.length}</h3>
              <ul className="space-y-0.5">
                {list.map((m) => (
                  <li key={m.user.id} className={cn('flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition hover:bg-white/5', !m.online && 'opacity-50')} data-member={m.user.username} data-online={m.online}>
                    <span className="relative shrink-0">
                      <Avatar name={m.user.username} src={m.user.avatar} frame={styleOf(m.user.style)?.frame} size="sm" />
                      <span className={cn('absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-surface', m.online ? 'bg-emerald-400' : 'bg-zinc-500')} />
                    </span>
                    <span className="min-w-0">
                      <UserName name={m.user.username} style={styleOf(m.user.style)} verified={m.user.verified} admin={m.user.admin} className="text-sm font-semibold" />
                      {m.role !== 'member' && <span className={cn('block text-[10px] font-bold uppercase tracking-wide', m.role === 'owner' ? 'text-amber-300' : 'text-accent')}>{ROLES.find((r) => r.id === m.role)?.label}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )
        )
      )}
    </aside>
  )

  const membersButton = (
    <button onClick={toggleMembers} title={showMembers ? 'Hide members' : 'Show members'} aria-label="Members" aria-pressed={showMembers} className={cn('rounded-lg p-1.5 transition hover:bg-white/10', showMembers ? 'text-text' : 'text-muted', !phone && 'max-lg:hidden')} data-toggle-members>
      <Users className="size-4.5" />
    </button>
  )

  return (
    <div className="relative flex min-w-0 flex-1" data-community={c.name} data-role={role}>
      {(!phone || !channel) && sidebar}
      {channel ? (
        <div key={channel.id} className="pane-in flex min-w-0 flex-1">
          <ChannelChat
            channel={channel}
            role={role}
            myId={myId}
            headerStart={
              phone ? (
                <button onClick={() => navigate(`/channels/${id}`)} aria-label="Back to the channel list" className="rounded-lg p-1.5 text-muted hover:bg-white/10 hover:text-text" data-chat-back>
                  <ArrowLeft className="size-5" />
                </button>
              ) : undefined
            }
            headerEnd={membersButton}
          />
        </div>
      ) : (
        !phone && (
          <div className="flex min-w-0 flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-xs space-y-2">
              <Hash className="mx-auto size-10 text-muted" />
              <p className="font-display text-lg font-bold">No channels here yet</p>
              <p className="text-sm text-muted">{can(role, 'manageChannels') ? 'Open settings to add the first one.' : 'Whoever runs this Channel hasn’t added any yet.'}</p>
            </div>
          </div>
        )
      )}
      {channel && showMembers && phone && <button aria-label="Close members" className="absolute inset-0 z-[9] bg-black/50" onClick={toggleMembers} />}
      {channel && showMembers && memberList}

      {settings && (
        <CommunitySettings
          community={c}
          myId={myId}
          initial={settings === 'main' ? undefined : settings}
          onClose={() => setSettings(null)}
          onChanged={refresh}
          onGone={() => {
            setSettings(null)
            navigate('/channels')
          }}
        />
      )}
    </div>
  )
}

/** A community's channels as they're shown: the ones without a category first, then each category. */
function inOrder(c: CommunityDetail): { category: Category | null; channels: Channel[] }[] {
  const of = (categoryId: string | null): Channel[] => c.channels.filter((ch) => ch.categoryId === categoryId).sort((a, b) => a.position - b.position)
  const loose = of(null)
  return [...(loose.length ? [{ category: null, channels: loose }] : []), ...[...c.categories].sort((a, b) => a.position - b.position).map((category) => ({ category, channels: of(category.id) }))]
}
