import { useCallback, useEffect, useState } from 'react'
import { Check, ImageUp, RotateCcw } from 'lucide-react'
import { ARTWORK_LABELS, type ArtworkKind, type ArtworkOption, type Game } from '@shared/types'
import { cn } from '@/lib/cn'
import { mediaUrl } from '@/lib/media'
import { useLibrary } from '@/state/library'
import { useToast } from '@/state/toasts'
import { Button, Dialog } from './Dialog'

const KINDS: ArtworkKind[] = ['cover', 'hero', 'logo', 'icon']

/** Grid cell shape per kind, so previews look like where the image is used. */
const ASPECT: Record<ArtworkKind, string> = {
  cover: 'aspect-[2/3]',
  hero: 'aspect-[96/31]',
  logo: 'aspect-[16/9]',
  icon: 'aspect-square'
}
const COLUMNS: Record<ArtworkKind, string> = {
  cover: 'grid-cols-5',
  hero: 'grid-cols-2',
  logo: 'grid-cols-3',
  icon: 'grid-cols-6'
}

const PATH: Record<ArtworkKind, keyof Pick<Game, 'coverPath' | 'heroPath' | 'logoPath' | 'iconPath'>> = {
  cover: 'coverPath',
  hero: 'heroPath',
  logo: 'logoPath',
  icon: 'iconPath'
}

/** Browse SteamGridDB artwork for a game, use your own image, or go back to automatic. */
export function ArtworkDialog({ game: initial, onClose }: { game: Game; onClose: () => void }): React.JSX.Element {
  const { games, replaceGame } = useLibrary()
  const toast = useToast()
  const game = games.find((g) => g.id === initial.id) ?? initial
  const [kind, setKind] = useState<ArtworkKind>('cover')
  const [options, setOptions] = useState<ArtworkOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (k: ArtworkKind) => {
    setOptions(null)
    setError(null)
    const res = await window.vanity.metadata.artworkOptions(initial.id, k)
    if (res.error !== undefined) setError(res.error)
    else setOptions(res.data)
  }, [initial.id])

  useEffect(() => {
    load(kind)
  }, [kind, load])

  async function run(label: string, action: () => ReturnType<typeof window.vanity.metadata.setArtwork>): Promise<void> {
    setBusy(label)
    const res = await action()
    setBusy(null)
    if (res.error !== undefined) toast(res.error, 'error')
    else if (res.data) replaceGame(res.data)
  }

  const current = mediaUrl(game[PATH[kind]])
  const locked = game.metadata.lockedArtwork.includes(kind)

  return (
    <Dialog
      title="Change artwork"
      description={game.name}
      onClose={onClose}
      size="2xl"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-border bg-surface px-4 py-3">
        {KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={cn(
              'rounded-lg px-3.5 py-1.5 text-sm font-medium transition',
              k === kind ? 'bg-white/10 text-text' : 'text-muted hover:text-text'
            )}
          >
            {ARTWORK_LABELS[k]}
          </button>
        ))}
        <div className="ml-auto flex shrink-0 gap-2">
          <Button onClick={() => run('file', () => window.vanity.metadata.setArtworkFromFile(game.id, kind))} disabled={busy !== null}>
            <ImageUp className="size-4" /> Use my own image
          </Button>
          {locked && (
            <Button onClick={() => run('reset', () => window.vanity.metadata.resetArtwork(game.id, kind))} disabled={busy !== null}>
              <RotateCcw className="size-4" /> Automatic
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex items-center gap-4 rounded-xl bg-surface-2 p-3">
          <div className={cn('w-24 shrink-0 overflow-hidden rounded-md bg-bg ring-1 ring-white/5', ASPECT[kind], kind === 'hero' && 'w-48')}>
            {current && <img src={current} alt="" className={cn('size-full', kind === 'logo' || kind === 'icon' ? 'object-contain' : 'object-cover')} />}
          </div>
          <p className="text-sm text-muted">
            {current ? (locked ? 'Your choice. It stays when metadata is refreshed.' : 'Picked automatically.') : 'No image yet.'}
          </p>
        </div>

        {error && <p className="text-sm text-accent">{error}</p>}
        {!options && !error && <p className="py-10 text-center text-sm text-muted">Loading artwork from SteamGridDB…</p>}
        {options?.length === 0 && <p className="py-10 text-center text-sm text-muted">SteamGridDB has no {ARTWORK_LABELS[kind].toLowerCase()} images for this game.</p>}
        {options && options.length > 0 && (
          <div className={cn('grid gap-3', COLUMNS[kind])}>
            {options.map((o) => (
              <button
                key={o.id}
                disabled={busy !== null}
                onClick={() => run(String(o.id), () => window.vanity.metadata.setArtwork(game.id, kind, o.url))}
                className={cn(
                  'group relative overflow-hidden rounded-lg bg-surface-2 ring-1 ring-white/5 transition hover:ring-2 hover:ring-accent disabled:opacity-60',
                  ASPECT[kind],
                  (kind === 'logo' || kind === 'icon') && 'bg-[repeating-conic-gradient(#1f2430_0_25%,#171b23_0_50%)] bg-[length:16px_16px]'
                )}
                title={`${o.width}×${o.height}`}
              >
                <img src={o.thumbUrl} alt="" loading="lazy" className={cn('size-full', kind === 'logo' || kind === 'icon' ? 'object-contain p-2' : 'object-cover')} />
                {busy === String(o.id) && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <span className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {locked && busy === null && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Check className="size-3.5 text-emerald-400" /> Saved
          </p>
        )}
      </div>
    </Dialog>
  )
}
