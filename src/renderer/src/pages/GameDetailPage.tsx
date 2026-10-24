import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, BookOpen, Clock, Eye, FolderOpen, HardDrive, Image, Info, MoreHorizontal, PlayCircle, RefreshCw, Star, Timer, Trophy, Users, Wand2, Wrench } from 'lucide-react'
import { PLAY_STATUS_LABELS, type GameDetails, type GameFriend, type GameLive, type GamePlayStats } from '@shared/types'
import { DetailsCard, Requirements } from '@/components/game/DetailsCard'
import { JournalCard } from '@/components/game/JournalCard'
import { STATUS_STYLES } from '@/lib/status'
import { MediaSection } from '@/components/game/MediaSection'
import { Milestones } from '@/components/game/Milestones'
import { NewsSection } from '@/components/game/NewsSection'
import { Section } from '@/components/game/parts'
import { RatingsCard } from '@/components/game/RatingsCard'
import { SessionHistory } from '@/components/game/SessionHistory'
import { SimilarGames } from '@/components/game/SimilarGames'
import { TimeToBeat } from '@/components/game/TimeToBeat'
import { YourStats } from '@/components/game/YourStats'
import { milestones } from '@/lib/playtime'
import { Avatar } from '@/components/Avatar'
import { useAccount } from '@/state/account'
import { SOURCE_LABELS } from '@shared/types'
import { ArtworkDialog } from '@/components/ArtworkDialog'
import { Button } from '@/components/Dialog'
import { MatchDialog } from '@/components/MatchDialog'
import { PlayButton } from '@/components/PlayButton'
import { SourceBadge } from '@/components/SourceBadge'
import { useGameMenu } from '@/components/useGameMenu'
import { cn } from '@/lib/cn'
import { formatBytes, formatCompact, formatPlaytime, formatRelativeDate } from '@/lib/format'
import { useToast } from '@/state/toasts'
import { useCoverTint } from '@/hooks/useCoverTint'
import { mediaUrl, nameHue } from '@/lib/media'
import { useLibrary } from '@/state/library'

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-10 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
        <Icon className="size-[18px] text-muted" />
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  )
}

/** A stat with a live pulse, for current players or viewers. */
function LiveStat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }): React.JSX.Element {
  return (
    <div className="animate-pop-in flex items-center gap-3">
      <div className="relative flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/25">
        <Icon className="size-[18px] text-emerald-400" />
        <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/70" />
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
        </span>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  )
}

const STORY_CLAMP = 280

function Storyline({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const long = text.length > STORY_CLAMP
  return (
    <div className="mt-6 border-t border-white/5 pt-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Story</h3>
      <p className="max-w-3xl select-text whitespace-pre-line leading-relaxed text-text/70">{open || !long ? text : `${text.slice(0, STORY_CLAMP).trimEnd()}…`}</p>
      {long && (
        <button className="mt-2 text-sm font-medium text-accent hover:underline" onClick={() => setOpen((v) => !v)}>
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  )
}

export function GameDetailPage(): React.JSX.Element {
  const { id } = useParams()
  const navigate = useNavigate()
  const { games, loading, updateGame, openFolder, pickExecutable, metadata } = useLibrary()
  const { openMenu, menu } = useGameMenu()
  const [dialog, setDialog] = useState<'match' | 'artwork' | null>(null)
  const game = games.find((g) => g.id === Number(id))
  const toast = useToast()
  const [live, setLive] = useState<GameLive | null>(null)
  const tint = useCoverTint(game ? mediaUrl(game.coverPath) : null)
  const account = useAccount()
  const [friendsPlayed, setFriendsPlayed] = useState<GameFriend[] | null>(null)

  useEffect(() => {
    setFriendsPlayed(null)
    if (!account?.signedIn) return
    let cancelled = false
    window.vanity.friends.forGame(Number(id)).then((r) => !cancelled && setFriendsPlayed(r.error === undefined ? r.data : []), () => {})
    return () => {
      cancelled = true
    }
  }, [id, account?.signedIn])

  useEffect(() => {
    setLive(null)
    let cancelled = false
    window.vanity.live.game(Number(id)).then((l) => !cancelled && setLive(l), () => {})
    return () => {
      cancelled = true
    }
  }, [id])

  // Your stats: reloaded when playtime changes (a session ended).
  const [playStats, setPlayStats] = useState<GamePlayStats | null>(null)
  const playtime = game?.playtimeSeconds ?? 0
  useEffect(() => {
    let cancelled = false
    window.vanity.games.playStats(Number(id)).then((s) => !cancelled && setPlayStats(s), () => {})
    return () => {
      cancelled = true
    }
  }, [id, playtime])
  useEffect(() => setPlayStats(null), [id])

  // Ratings, credits, media and news (cached in the main process).
  const [details, setDetails] = useState<GameDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(true)
  const igdbId = game?.metadata.igdbId ?? null
  const loadDetails = useCallback(
    (refresh = false) => {
      let cancelled = false
      setDetailsLoading(true)
      window.vanity.games
        .details(Number(id), refresh)
        .then((d) => !cancelled && setDetails(d), () => {})
        .finally(() => !cancelled && setDetailsLoading(false))
      return () => {
        cancelled = true
      }
    },
    [id]
  )
  useEffect(() => {
    setDetails(null)
  }, [id])
  // Refetch once the game gets matched (its IGDB ID unlocks most details).
  useEffect(() => loadDetails(), [loadDetails, igdbId])

  const [diskSize, setDiskSize] = useState<number | null | undefined>(undefined)
  const installPath = game?.installPath ?? null
  useEffect(() => {
    setDiskSize(undefined)
    if (!installPath) return setDiskSize(null)
    let cancelled = false
    window.vanity.games.diskSize(Number(id)).then((n) => !cancelled && setDiskSize(n), () => !cancelled && setDiskSize(null))
    return () => {
      cancelled = true
    }
  }, [id, installPath])

  const badges = useMemo(
    () =>
      game && playStats
        ? milestones({ playtimeSeconds: game.playtimeSeconds, playStatus: game.playStatus, firstPlayedAt: playStats.firstPlayedAt, sessions: playStats.history })
        : [],
    [game, playStats]
  )

  const openWorkshop = async (): Promise<void> => {
    const res = await window.vanity.live.openWorkshop(Number(id))
    if (res.error !== undefined) toast(res.error, 'error')
  }

  // Parallax: the banner drifts slower than the page and the title fades as you scroll.
  // Written straight to the elements' style so scrolling doesn't re-render React.
  const heroLayer = useRef<HTMLDivElement>(null)
  const heroText = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const y = e.currentTarget.scrollTop
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      if (heroLayer.current) heroLayer.current.style.transform = `translate3d(0, ${y * 0.4}px, 0)`
      if (heroText.current) {
        heroText.current.style.transform = `translate3d(0, ${y * 0.15}px, 0)`
        heroText.current.style.opacity = String(Math.max(0, 1 - y / 380))
      }
    })
  }, [])

  if (!game) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted">
        {!loading && <p>This game is no longer in your library.</p>}
        <Button onClick={() => navigate('/library')}>Back to library</Button>
      </div>
    )
  }

  const hue = nameHue(game.name)
  const hero = mediaUrl(game.heroPath)
  const cover = mediaUrl(game.coverPath)
  const logo = mediaUrl(game.logoPath)
  const icon = mediaUrl(game.iconPath)
  const status = game.metadata.status
  const fetching = status === 'pending' && metadata.running
  const folder = game.installPath ?? game.executablePath

  return (
    <div className="h-full overflow-y-auto" onScroll={onScroll}>
      <section key={game.id} className="relative h-[min(56vh,520px)] min-h-80 overflow-hidden">
        <div ref={heroLayer} className="absolute inset-0 will-change-transform">
          {hero ? (
            <img src={hero} alt="" className="animate-hero-in absolute inset-0 size-full object-cover" draggable={false} />
          ) : cover ? (
            // No banner: a blurred, enlarged cover still gives the page the game's colours.
            <img src={cover} alt="" className="absolute inset-0 size-full scale-125 animate-[fade-in_800ms_ease-out] object-cover opacity-60 blur-3xl" draggable={false} />
          ) : (
            <div
              className="absolute inset-0 animate-[fade-in_600ms_ease-out]"
              style={{
                background: `radial-gradient(90% 120% at 75% 10%, hsl(${hue} 60% 30%) 0%, transparent 60%),
                             radial-gradient(60% 90% at 10% 100%, hsl(${(hue + 50) % 360} 55% 22%) 0%, transparent 70%),
                             linear-gradient(180deg, hsl(${hue} 35% 14%), hsl(${hue} 30% 8%))`
              }}
            />
          )}
        </div>
        {/* The cover's colour washes over the banner, so every game page feels like its own. */}
        {tint && (
          <div
            className="pointer-events-none absolute inset-0 animate-[fade-in_900ms_ease-out] mix-blend-soft-light"
            style={{ background: `radial-gradient(80% 90% at 70% 20%, ${tint}cc, transparent 70%)` }}
          />
        )}
        {/* Fade into the page and darken behind the title for legibility. */}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg/80 via-bg/10 to-transparent" />

        <button
          onClick={() => navigate(-1)}
          className="absolute left-8 top-12 flex items-center gap-2 rounded-full bg-black/40 px-3.5 py-2 text-sm backdrop-blur transition hover:bg-black/60"
        >
          <ArrowLeft className="size-4" /> Back
        </button>

        <div ref={heroText} className="absolute inset-x-10 bottom-10 will-change-transform">
          {logo ? (
            <img
              src={logo}
              alt={game.name}
              className="animate-rise-in max-h-36 max-w-md object-contain object-left drop-shadow-2xl"
              style={{ '--delay': '150ms' } as React.CSSProperties}
              draggable={false}
            />
          ) : (
            <h1
              className="animate-rise-in max-w-3xl text-5xl font-black leading-[1.05] tracking-tight drop-shadow-2xl"
              style={{ '--delay': '150ms' } as React.CSSProperties}
            >
              {game.name}
            </h1>
          )}
          <div className="animate-rise-in mt-4 flex items-center gap-3 text-sm text-muted" style={{ '--delay': '260ms' } as React.CSSProperties}>
            {icon && <img src={icon} alt="" className="size-6 rounded" draggable={false} />}
            <SourceBadge source={game.source} />
            {game.developer && <span>{game.developer}</span>}
            {game.releaseDate && <span>{game.releaseDate.slice(0, 4)}</span>}
            {game.playStatus && (
              <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1', STATUS_STYLES[game.playStatus])}>{PLAY_STATUS_LABELS[game.playStatus]}</span>
            )}
            {game.userRating && (
              <span className="flex items-center gap-0.5" aria-label={`Your rating: ${game.userRating} of 5`}>
                {Array.from({ length: game.userRating }, (_, i) => (
                  <Star key={i} className="size-3.5 fill-amber-400 text-amber-400" />
                ))}
              </span>
            )}
          </div>
        </div>
      </section>

      <div key={`body-${game.id}`} className="relative space-y-10 bg-bg px-10 pb-16 pt-2">
        {tint && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-80 animate-[fade-in_900ms_ease-out] opacity-25"
            style={{ background: `radial-gradient(60% 100% at 20% 0%, ${tint}, transparent 70%)` }}
          />
        )}
        <div className="animate-rise-in flex flex-wrap items-center gap-3" style={{ '--delay': '360ms' } as React.CSSProperties}>
          <PlayButton game={game} />
          <button
            onClick={() => updateGame(game.id, { favorite: !game.favorite })}
            title={game.favorite ? 'Remove from favorites' : 'Add to favorites'}
            className={cn(
              'flex size-14 items-center justify-center rounded-xl border transition',
              game.favorite ? 'border-amber-400/40 bg-amber-400/10' : 'border-border bg-surface-2 hover:border-white/20'
            )}
          >
            <Star className={cn('size-5', game.favorite ? 'fill-amber-400 text-amber-400' : 'text-muted')} />
          </button>
          <button
            onClick={(e) => openMenu(e, game)}
            title="More"
            className="flex size-14 items-center justify-center rounded-xl border border-border bg-surface-2 transition hover:border-white/20"
          >
            <MoreHorizontal className="size-5 text-muted" />
          </button>

          {live?.workshop && (
            <button
              onClick={openWorkshop}
              title="Open this game's Steam Workshop in Steam"
              className="flex h-14 items-center gap-2 rounded-xl border border-border bg-surface-2 px-5 font-semibold transition hover:-translate-y-0.5 hover:border-white/25"
            >
              <Wrench className="size-5 text-muted" /> Workshop
            </button>
          )}

          <div className="ml-6 flex flex-wrap gap-8">
            {live?.players != null && live.players > 0 ? (
              <LiveStat icon={Users} label="Playing now" value={`${formatCompact(live.players)} on Steam`} />
            ) : live?.viewers ? (
              <LiveStat icon={Eye} label="Watching now" value={`${formatCompact(live.viewers)} on Twitch`} />
            ) : null}
            <Stat icon={Timer} label="Playtime" value={formatPlaytime(game.playtimeSeconds)} />
            <Stat icon={Clock} label="Last played" value={formatRelativeDate(game.lastPlayedAt)} />
            {playStats && playStats.sessions > 0 && <Stat icon={PlayCircle} label="Sessions" value={String(playStats.sessions)} />}
            {playStats?.rank && <Stat icon={Trophy} label="Library rank" value={`#${playStats.rank} of ${playStats.playedGames}`} />}
          </div>
        </div>

        {game.missing && (
          <div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-accent" />
            <p>
              The last scan couldn't find this game. It may have been uninstalled or moved, or its drive may be disconnected.
              Your playtime is kept, and it will reappear automatically if it's found again.
            </p>
          </div>
        )}

        {(status === 'unmatched' || status === 'no-keys' || status === 'error') && (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
            <Info className="size-5 shrink-0 text-muted" />
            <p className="flex-1 text-muted">{game.metadata.error ?? 'No details found for this game yet.'}</p>
            {status === 'no-keys' ? (
              <Button onClick={() => navigate('/settings')}>Open settings</Button>
            ) : (
              <Button onClick={() => setDialog('match')}>
                <Wand2 className="size-4" /> Fix match
              </Button>
            )}
          </div>
        )}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-6">
            <Section icon={BookOpen} title="About" delay={460}>
              {game.genres.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {game.genres.map((g) => (
                    <span key={g} className="rounded-full bg-white/5 px-3 py-1 text-xs text-text/80 ring-1 ring-white/10">
                      {g}
                    </span>
                  ))}
                </div>
              )}
              {game.description ? (
                <p className="max-w-3xl select-text whitespace-pre-line leading-relaxed text-text/80">{game.description}</p>
              ) : (
                <p className="text-sm text-muted">{fetching ? 'Fetching details…' : 'No description available.'}</p>
              )}
              {details?.storyline && details.storyline !== game.description && <Storyline text={details.storyline} />}
            </Section>

            <YourStats game={game} stats={playStats} delay={520} />
            {badges.length > 0 && <Milestones list={badges} delay={560} />}
            {details?.timeToBeat && <TimeToBeat ttb={details.timeToBeat} playtime={game.playtimeSeconds} delay={600} />}
            {details && <MediaSection shots={details.screenshots} videos={details.videos} delay={620} />}
            {details && <NewsSection news={details.news} delay={640} />}
            {playStats && <SessionHistory history={playStats.history} delay={660} />}

            {account?.signedIn && (
              <Section icon={Users} title="Friends who played" delay={680}>
                {friendsPlayed === null ? (
                  <div className="shimmer h-14 rounded-xl bg-white/[0.03]" />
                ) : friendsPlayed.length === 0 ? (
                  <p className="text-sm text-muted">None of your friends have played this yet.</p>
                ) : (
                  <ul className="flex flex-wrap gap-3">
                    {friendsPlayed.map((f, i) => (
                      <li
                        key={f.id}
                        style={{ '--i': i } as React.CSSProperties}
                        className="animate-card-in flex items-center gap-3 rounded-2xl border border-border bg-surface-2 py-2 pl-2 pr-4"
                      >
                        <Avatar name={f.username} size="sm" />
                        <span>
                          <span className="block text-sm font-semibold">{f.username}</span>
                          <span className="block text-xs text-muted">
                            {formatPlaytime(f.playtimeSeconds)}
                            {f.lastPlayedAt ? ` · ${formatRelativeDate(f.lastPlayedAt).toLowerCase()}` : ''}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            {details && <SimilarGames games={details.similar} delay={700} />}
          </div>

          <aside className="space-y-6">
            <JournalCard game={game} onChange={(patch) => void updateGame(game.id, patch)} delay={480} />
            {details && <RatingsCard ratings={details.ratings} delay={540} />}
            <DetailsCard game={game} details={details} delay={580} />

            <Section icon={HardDrive} title="Installation" delay={620}>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-muted">Source</dt>
                  <dd>{SOURCE_LABELS[game.source]}</dd>
                </div>
                <div>
                  <dt className="text-muted">Install folder</dt>
                  <dd className="break-all select-text">{game.installPath ?? 'Unknown'}</dd>
                </div>
                {game.installPath && (
                  <div>
                    <dt className="text-muted">Size on disk</dt>
                    <dd>{diskSize === undefined ? <span className="shimmer inline-block h-4 w-20 rounded bg-white/5" /> : diskSize === null ? 'Unknown' : formatBytes(diskSize)}</dd>
                  </div>
                )}
                {game.source === 'steam' || game.source === 'epic' ? (
                  <div>
                    <dt className="text-muted">Launches through</dt>
                    <dd>{game.source === 'steam' ? 'Steam' : 'Epic Games Launcher'}</dd>
                  </div>
                ) : (
                  <div>
                    <dt className="flex items-center justify-between text-muted">
                      Executable
                      <button className="text-xs text-accent hover:underline" onClick={() => pickExecutable(game.id)}>
                        Change
                      </button>
                    </dt>
                    <dd className="break-all select-text">{game.executablePath ?? 'Not set'}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted">Added to Vanity</dt>
                  <dd>{formatRelativeDate(game.addedAt)}</dd>
                </div>
              </dl>
              <div className="mt-4 space-y-2">
                <Button className="w-full" disabled={!folder} onClick={() => openFolder(game.id)}>
                  <FolderOpen className="size-4" /> Open install folder
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => setDialog('artwork')}>
                    <Image className="size-4" /> Artwork
                  </Button>
                  <Button onClick={() => setDialog('match')}>
                    <Wand2 className="size-4" /> Fix match
                  </Button>
                </div>
              </div>
            </Section>

            {details?.requirements && <Requirements req={details.requirements} delay={660} />}

            <p className="flex items-center justify-between gap-3 px-1 text-xs text-muted">
              <span>
                {details
                  ? `Details from ${[details.sources.igdb && 'IGDB', details.sources.steam && 'Steam'].filter(Boolean).join(' and ') || 'nowhere yet'} · ${formatRelativeDate(details.fetchedAt).toLowerCase()}`
                  : detailsLoading
                    ? 'Loading details…'
                    : 'No online details'}
              </span>
              <button className="flex items-center gap-1 hover:text-text disabled:opacity-50" disabled={detailsLoading} onClick={() => loadDetails(true)}>
                <RefreshCw className={cn('size-3.5', detailsLoading && 'animate-spin')} /> Refresh
              </button>
            </p>
          </aside>
        </div>
      </div>
      {menu}
      {dialog === 'match' && <MatchDialog game={game} onClose={() => setDialog(null)} />}
      {dialog === 'artwork' && <ArtworkDialog game={game} onClose={() => setDialog(null)} />}
    </div>
  )
}
