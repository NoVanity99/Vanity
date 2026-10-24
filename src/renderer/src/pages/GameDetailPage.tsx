import { useCallback, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Calendar, Clock, FolderOpen, Image, Info, MoreHorizontal, Star, Timer, Wand2 } from 'lucide-react'
import { SOURCE_LABELS } from '@shared/types'
import { ArtworkDialog } from '@/components/ArtworkDialog'
import { Button } from '@/components/Dialog'
import { MatchDialog } from '@/components/MatchDialog'
import { PlayButton } from '@/components/PlayButton'
import { SourceBadge } from '@/components/SourceBadge'
import { useGameMenu } from '@/components/useGameMenu'
import { cn } from '@/lib/cn'
import { formatPlaytime, formatRelativeDate } from '@/lib/format'
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

export function GameDetailPage(): React.JSX.Element {
  const { id } = useParams()
  const navigate = useNavigate()
  const { games, loading, updateGame, openFolder, pickExecutable, metadata } = useLibrary()
  const { openMenu, menu } = useGameMenu()
  const [dialog, setDialog] = useState<'match' | 'artwork' | null>(null)
  const game = games.find((g) => g.id === Number(id))

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
          </div>
        </div>
      </section>

      <div key={`body-${game.id}`} className="relative space-y-10 bg-bg px-10 pb-16 pt-2">
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

          <div className="ml-6 flex flex-wrap gap-8">
            <Stat icon={Timer} label="Playtime" value={formatPlaytime(game.playtimeSeconds)} />
            <Stat icon={Clock} label="Last played" value={formatRelativeDate(game.lastPlayedAt)} />
            <Stat icon={Calendar} label="Added" value={formatRelativeDate(game.addedAt)} />
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
            {status === 'no-keys' ? null : (
              <Button onClick={() => setDialog('match')}>
                <Wand2 className="size-4" /> Fix match
              </Button>
            )}
          </div>
        )}

        <div className="animate-rise-in grid gap-10 lg:grid-cols-[1fr_360px]" style={{ '--delay': '460ms' } as React.CSSProperties}>
          <section>
            <h2 className="mb-3 text-lg font-semibold">About</h2>
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
              <p className="max-w-3xl whitespace-pre-line leading-relaxed text-text/80">{game.description}</p>
            ) : (
              <p className="text-sm text-muted">{fetching ? 'Fetching details…' : 'No description available.'}</p>
            )}
          </section>

          <section className="space-y-4 rounded-2xl border border-border bg-surface p-5">
            <h2 className="font-semibold">Installation</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted">Source</dt>
                <dd>{SOURCE_LABELS[game.source]}</dd>
              </div>
              <div>
                <dt className="text-muted">Install folder</dt>
                <dd className="break-all select-text">{game.installPath ?? 'Unknown'}</dd>
              </div>
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
            </dl>
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
          </section>
        </div>
      </div>
      {menu}
      {dialog === 'match' && <MatchDialog game={game} onClose={() => setDialog(null)} />}
      {dialog === 'artwork' && <ArtworkDialog game={game} onClose={() => setDialog(null)} />}
    </div>
  )
}
