import { useNavigate } from 'react-router-dom'
import { Check, CircleAlert, Download, FileText, Pause, Play, Trash2, X } from 'lucide-react'
import { SOURCE_LABELS, type DownloadItem } from '@shared/types'
import { Button } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import { mediaUrl, nameHue } from '@/lib/media'
import { formatEta, formatSize, formatSpeed, useDownloads, useStores } from '@/state/downloads'

const STATE_LABEL: Record<DownloadItem['state'], string> = {
  queued: 'Waiting',
  preparing: 'Getting ready…',
  downloading: 'Downloading',
  paused: 'Paused',
  installing: 'Installing…',
  done: 'Installed',
  failed: 'Failed'
}

function Row({ item }: { item: DownloadItem }): React.JSX.Element {
  const navigate = useNavigate()
  const cover = mediaUrl(item.coverPath)
  const hue = nameHue(item.name)
  const active = item.state === 'downloading' || item.state === 'preparing' || item.state === 'installing'
  const percent = Math.max(0, Math.min(100, item.percent))
  const bar = item.state === 'failed' ? 'bg-accent' : item.state === 'done' ? 'bg-emerald-500' : item.state === 'paused' || item.state === 'queued' ? 'bg-white/30' : 'bg-accent'

  return (
    <li className="rounded-2xl border border-border bg-surface p-4" data-download={item.state}>
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(`/game/${item.gameId}`)}
          title={`Open ${item.name}`}
          className="relative size-16 shrink-0 overflow-hidden rounded-xl"
          style={{ background: `linear-gradient(160deg, hsl(${hue} 45% 30%), hsl(${(hue + 40) % 360} 45% 14%))` }}
        >
          {cover ? <img src={cover} alt="" className="size-full object-cover" draggable={false} /> : <span className="absolute inset-0 flex items-center justify-center text-2xl font-black text-white/30">{item.name.trim().charAt(0).toUpperCase()}</span>}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="truncate font-semibold">{item.name}</p>
            <span className="shrink-0 text-xs text-muted">{SOURCE_LABELS[item.store]}</span>
          </div>

          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-white/8"
            role="progressbar"
            aria-label={`${item.name}: ${STATE_LABEL[item.state]}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
          >
            <div className={cn('h-full rounded-full transition-[width] duration-500', bar, item.state === 'preparing' && 'animate-pulse')} style={{ width: `${item.state === 'preparing' ? 100 : Math.max(percent, item.state === 'queued' ? 0 : 1)}%` }} />
          </div>

          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            <span className={cn('font-semibold', item.state === 'failed' ? 'text-accent' : item.state === 'done' ? 'text-emerald-400' : 'text-text')}>
              {STATE_LABEL[item.state]}
              {(item.state === 'downloading' || item.state === 'paused') && ` · ${Math.floor(percent)}%`}
            </span>
            {item.totalBytes > 0 && item.state !== 'done' && (
              <span className="tabular-nums">
                {formatSize(item.downloadedBytes)} of {formatSize(item.totalBytes)}
              </span>
            )}
            {item.state === 'downloading' && item.speedBps > 0 && <span className="tabular-nums">{formatSpeed(item.speedBps)}</span>}
            {item.state === 'downloading' && item.etaSeconds !== null && <span>{formatEta(item.etaSeconds)}</span>}
            {item.state === 'installing' && item.store === 'gog' && <span>If Windows asks for permission, choose Yes.</span>}
            <span className="truncate font-mono" title={item.installDir}>
              {item.installDir}
            </span>
          </p>
          {item.error && (
            <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-accent">
              <CircleAlert className="mt-0.5 size-4 shrink-0" /> {item.error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {(item.state === 'downloading' || item.state === 'preparing' || item.state === 'queued') && (
            <button onClick={() => void window.vanity.downloads.pause(item.id)} title="Pause" aria-label={`Pause ${item.name}`} className="flex size-9 items-center justify-center rounded-full bg-white/8 transition hover:bg-white/15">
              <Pause className="size-4" />
            </button>
          )}
          {(item.state === 'paused' || item.state === 'failed') && (
            <button
              onClick={() => void window.vanity.downloads.resume(item.id)}
              title={item.state === 'failed' ? 'Try again' : 'Resume'}
              aria-label={`${item.state === 'failed' ? 'Try again' : 'Resume'} ${item.name}`}
              className="flex size-9 items-center justify-center rounded-full bg-accent text-white transition hover:brightness-110"
            >
              <Play className="ml-0.5 size-4 fill-current" />
            </button>
          )}
          {item.state === 'done' ? (
            <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <Check className="size-4" />
            </span>
          ) : (
            // An installer that is already running is left to finish.
            <button
              onClick={() => void window.vanity.downloads.cancel(item.id)}
              disabled={item.state === 'installing'}
              title={item.state === 'installing' ? "Can't cancel while it installs" : 'Cancel and delete what was downloaded'}
              aria-label={`Cancel ${item.name}`}
              className="flex size-9 items-center justify-center rounded-full bg-white/8 text-muted transition hover:bg-red-600 hover:text-white disabled:opacity-40 disabled:hover:bg-white/8 disabled:hover:text-muted"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>
      {active && item.state === 'downloading' && <span className="sr-only">{Math.floor(percent)} percent</span>}
    </li>
  )
}

export function DownloadsPage(): React.JSX.Element {
  const items = useDownloads()
  const stores = useStores()
  const navigate = useNavigate()
  const waiting = items.filter((i) => i.state !== 'done')
  const finished = items.filter((i) => i.state === 'done')

  return (
    <div className="h-full overflow-y-auto">
      <div className="stagger mx-auto max-w-4xl space-y-6 px-10 pb-16 pt-12 max-md:px-4 max-md:pt-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Downloads</h1>
            <p className="mt-1 text-sm text-muted">Epic and GOG games install here, one at a time. Steam games install through Steam.</p>
          </div>
          <div className="flex gap-2">
            {finished.length > 0 && (
              <Button onClick={() => void window.vanity.downloads.clearFinished()}>
                <Trash2 className="size-4" /> Clear finished
              </Button>
            )}
            <Button variant="ghost" onClick={() => void window.vanity.downloads.showLog()} title="Open the downloader's log, for troubleshooting">
              <FileText className="size-4" /> Log
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
              <Download className="size-6" />
            </span>
            <p className="mt-4 text-lg font-semibold">Nothing downloading</p>
            <p className="mt-1 max-w-md text-sm text-muted">
              {stores && !stores.epic.signedIn && !stores.gog.signedIn
                ? 'Link your Epic or GOG account, then press Install on a game in your library.'
                : 'Press Install on a game in your library that isn\'t installed yet.'}
            </p>
            <div className="mt-5 flex gap-2">
              {stores && !stores.epic.signedIn && !stores.gog.signedIn && (
                <Button variant="primary" onClick={() => navigate('/account')}>
                  Linked accounts
                </Button>
              )}
              <Button onClick={() => navigate('/library')}>Library</Button>
            </div>
          </div>
        ) : (
          <>
            {waiting.length > 0 && (
              <ul className="space-y-3" aria-label="Queue">
                {waiting.map((i) => (
                  <Row key={i.id} item={i} />
                ))}
              </ul>
            )}
            {finished.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted">Finished</h2>
                <ul className="space-y-3">
                  {finished.map((i) => (
                    <Row key={i.id} item={i} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
