import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Calendar, Clock, FolderOpen, MoreHorizontal, Play, Star, Timer } from 'lucide-react'
import { SOURCE_LABELS } from '@shared/types'
import { Button } from '@/components/Dialog'
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
  const { games, loading, updateGame, openFolder } = useLibrary()
  const { openMenu, menu } = useGameMenu()
  const game = games.find((g) => g.id === Number(id))

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
  const logo = mediaUrl(game.logoPath)
  const folder = game.installPath ?? game.executablePath

  return (
    <div className="h-full overflow-y-auto">
      <section className="relative h-[min(56vh,520px)] min-h-80 overflow-hidden">
        {hero ? (
          <img src={hero} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(90% 120% at 75% 10%, hsl(${hue} 60% 30%) 0%, transparent 60%),
                           radial-gradient(60% 90% at 10% 100%, hsl(${(hue + 50) % 360} 55% 22%) 0%, transparent 70%),
                           linear-gradient(180deg, hsl(${hue} 35% 14%), hsl(${hue} 30% 8%))`
            }}
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

        <div className="absolute inset-x-10 bottom-10">
          {logo ? (
            <img src={logo} alt={game.name} className="max-h-36 max-w-md object-contain drop-shadow-2xl" draggable={false} />
          ) : (
            <h1 className="max-w-3xl text-5xl font-black leading-[1.05] tracking-tight drop-shadow-2xl">{game.name}</h1>
          )}
          <div className="mt-4 flex items-center gap-3 text-sm text-muted">
            <SourceBadge source={game.source} />
            {game.developer && <span>{game.developer}</span>}
            {game.releaseDate && <span>{game.releaseDate.slice(0, 4)}</span>}
            {game.genres.length > 0 && <span>{game.genres.slice(0, 3).join(' · ')}</span>}
          </div>
        </div>
      </section>

      <div className="space-y-10 px-10 pb-16 pt-2">
        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled
            title="Launching arrives in stage 4"
            className="flex h-14 items-center gap-3 rounded-xl bg-accent px-10 text-lg font-bold text-white shadow-xl shadow-accent/25 transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play className="size-5 fill-current" /> Play
          </button>
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

        <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
          <section>
            <h2 className="mb-3 text-lg font-semibold">About</h2>
            {game.description ? (
              <p className="max-w-3xl whitespace-pre-line leading-relaxed text-text/80">{game.description}</p>
            ) : (
              <p className="text-sm text-muted">No description yet. Descriptions, genres and artwork are added in stage 5.</p>
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
              {game.executablePath && (
                <div>
                  <dt className="text-muted">Executable</dt>
                  <dd className="break-all select-text">{game.executablePath}</dd>
                </div>
              )}
            </dl>
            <Button className="w-full" disabled={!folder} onClick={() => openFolder(game.id)}>
              <FolderOpen className="size-4" /> Open install folder
            </Button>
          </section>
        </div>
      </div>
      {menu}
    </div>
  )
}
