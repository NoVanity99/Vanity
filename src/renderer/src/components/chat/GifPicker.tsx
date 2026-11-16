import { useEffect, useRef, useState } from 'react'
import { Loader2, Search, Upload, X } from 'lucide-react'
import { MAX_GIF_BYTES, type GifRef, type GifResult } from '@shared/groups'
import { cn } from '@/lib/cn'

/** Reads a file as base64 (without the data: prefix). */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(new Error("That file couldn't be read."))
    r.readAsDataURL(file)
  })
}

/**
 * Pick a GIF: search (KLIPY, through Vanity's server), or send one from your device.
 * Trending GIFs show before you type. The pick is sent straight away.
 */
export function GifPicker({ onPick, onClose, className }: { onPick: (gif: GifRef) => void; onClose: () => void; className?: string }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GifResult[] | null>(null)
  const [off, setOff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    setError(null)
    const t = setTimeout(
      () => {
        setResults(null)
        void window.vanity.gifs.search(query.trim()).then(
          (r) => {
            if (!alive) return
            if (r.error !== undefined) {
              if (r.off) setOff(true)
              else setError(r.error)
              setResults([])
            } else setResults(r.data)
          },
          () => alive && setResults([])
        )
      },
      query ? 300 : 0
    )
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query])

  // Closes on a click outside or Escape.
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-gif-toggle]')) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  const upload = async (f: File | undefined): Promise<void> => {
    if (!f) return
    setError(null)
    if (f.type !== 'image/gif' && !/\.gif$/i.test(f.name)) return setError('Pick a .gif file.')
    if (f.size > MAX_GIF_BYTES) return setError(`That GIF is too big (up to ${MAX_GIF_BYTES / 1024 / 1024} MB).`)
    setUploading(true)
    try {
      const r = await window.vanity.gifs.upload(await base64Of(f))
      if (r.error !== undefined) return setError(r.error)
      onPick({ kind: 'media', id: r.data })
    } catch (err) {
      setError(err instanceof Error ? err.message : "That GIF couldn't be sent.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div ref={box} className={cn('animate-pop-in flex w-80 flex-col rounded-2xl border border-white/15 bg-surface p-2.5 shadow-2xl shadow-black/60', className)} data-gif-picker>
      <div className="flex items-center gap-2">
        {!off && (
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search GIFs" aria-label="Search GIFs" className="h-9 w-full rounded-lg border border-border bg-surface-2 pl-8 pr-2 text-sm outline-none focus:border-accent" data-gif-search />
          </label>
        )}
        <button onClick={onClose} aria-label="Close" className="ml-auto rounded-lg p-1.5 text-muted hover:bg-white/10 hover:text-text">
          <X className="size-4" />
        </button>
      </div>

      {!off && (
        <div className="mt-2 h-64 overflow-y-auto [scrollbar-width:thin]">
          {results === null ? (
            <p className="flex h-full items-center justify-center text-muted">
              <Loader2 className="size-5 animate-spin" />
            </p>
          ) : results.length === 0 ? (
            <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted">{error ?? 'No GIFs found.'}</p>
          ) : (
            <div className="columns-2 gap-1.5">
              {results.map((g) => (
                <button key={g.id} onClick={() => onPick({ kind: 'url', url: g.url })} className="mb-1.5 block w-full overflow-hidden rounded-lg bg-white/5 transition hover:ring-2 hover:ring-accent" title="Send this GIF" data-gif-result>
                  <img src={g.preview} alt="" loading="lazy" className="w-full" style={g.width && g.height ? { aspectRatio: `${g.width} / ${g.height}` } : undefined} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {off && <p className="px-1 py-2 text-xs text-muted">GIF search isn't set up yet. You can send GIFs from your device.</p>}
      {(off || error) && error && <p className="px-1 pt-1 text-xs text-accent">{error}</p>}

      <input ref={file} type="file" accept="image/gif,.gif" className="hidden" onChange={(e) => void upload(e.target.files?.[0]).finally(() => (e.target.value = ''))} data-gif-file />
      <button onClick={() => file.current?.click()} disabled={uploading} className="mt-2 flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold transition hover:border-white/25 disabled:opacity-60" data-gif-upload>
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {uploading ? 'Sending…' : 'Send a GIF from your device'}
      </button>
      {!off && <p className="mt-1.5 text-center text-[10px] text-muted/70">Search by KLIPY</p>}
    </div>
  )
}
