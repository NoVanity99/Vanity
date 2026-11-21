import { useEffect, useRef, useState } from 'react'
import { Check, ImagePlus, Loader2, Minus, Plus, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { Button, Dialog } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import { cropAvatar, DEFAULT_AVATARS, defaultAvatar, loadPicture, type Crop } from '@/lib/avatarImage'

const VIEW = 260
const MAX_ZOOM = 4

/** Drag the picture and zoom until the circle shows what you want. */
function CropDialog({ img, onDone, onClose }: { img: HTMLImageElement; onDone: (crop: Crop) => void; onClose: () => void }): React.JSX.Element {
  // How many screen pixels one picture pixel takes when the whole short side just fits.
  const fit = VIEW / Math.min(img.naturalWidth, img.naturalHeight)
  const [zoom, setZoom] = useState(1)
  // The picture's top-left corner inside the square, in screen pixels.
  const [pos, setPos] = useState(() => ({ x: (VIEW - img.naturalWidth * fit) / 2, y: (VIEW - img.naturalHeight * fit) / 2 }))
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const clamp = (p: { x: number; y: number }, z: number): { x: number; y: number } => {
    const w = img.naturalWidth * fit * z
    const h = img.naturalHeight * fit * z
    return { x: Math.min(0, Math.max(VIEW - w, p.x)), y: Math.min(0, Math.max(VIEW - h, p.y)) }
  }
  /** Zooms around the middle of the square, so the part you're looking at stays put. */
  const zoomTo = (next: number): void => {
    const z = Math.min(MAX_ZOOM, Math.max(1, next))
    setPos((p) => clamp({ x: VIEW / 2 - ((VIEW / 2 - p.x) * z) / zoom, y: VIEW / 2 - ((VIEW / 2 - p.y) * z) / zoom }, z))
    setZoom(z)
  }

  const scale = fit * zoom
  return (
    <Dialog
      title="Position your picture"
      description="Drag it around and zoom. What's inside the circle is what friends see."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onDone({ x: -pos.x / scale, y: -pos.y / scale, side: VIEW / scale })} data-crop-save>
            <Check className="size-4" /> Use this picture
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 p-6" data-crop-dialog>
        <div
          className="relative cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-black active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }, zoom))
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
          data-crop-area
        >
          <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute left-0 top-0 max-w-none" style={{ width: img.naturalWidth * scale, height: img.naturalHeight * scale, transform: `translate(${pos.x}px, ${pos.y}px)` }} />
          {/* Everything outside the circle is dimmed. */}
          <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(0,0,0,0.6)] ring-2 ring-white/70" />
        </div>
        <div className="flex w-full max-w-xs items-center gap-3">
          <button type="button" onClick={() => zoomTo(zoom - 0.25)} aria-label="Zoom out" className="rounded-lg border border-border p-1.5 text-muted transition hover:text-text">
            <Minus className="size-4" />
          </button>
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} aria-label="Zoom" className="h-1.5 flex-1 accent-[var(--color-accent)]" data-crop-zoom />
          <button type="button" onClick={() => zoomTo(zoom + 0.25)} aria-label="Zoom in" className="rounded-lg border border-border p-1.5 text-muted transition hover:text-text">
            <Plus className="size-4" />
          </button>
        </div>
      </div>
    </Dialog>
  )
}

/**
 * Choosing a profile picture: upload one and crop it, or take a ready-made one.
 * Used in Account and when a new account is being set up, so both always offer the same.
 * `onSave` stores the picture (null removes it) and throws with a readable message when it can't.
 */
export function PicturePicker({ name, avatar, onSave, disabled }: { name: string; avatar: string | null; onSave: (avatar: string | null) => Promise<void>; disabled?: boolean }): React.JSX.Element {
  const file = useRef<HTMLInputElement>(null)
  const [cropping, setCropping] = useState<HTMLImageElement | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  const save = async (key: string, make: () => string | null): Promise<void> => {
    setBusy(key)
    setError(null)
    try {
      await onSave(make())
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : 'Could not use that picture.')
    } finally {
      if (alive.current) setBusy(null)
    }
  }
  const off = disabled || busy !== null

  return (
    <div data-picture-picker>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={name} src={avatar} size="lg" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            aria-label="Choose a profile picture"
            onChange={(e) => {
              const picked = e.target.files?.[0]
              e.target.value = ''
              if (!picked) return
              setError(null)
              loadPicture(picked).then(setCropping, (err: unknown) => setError(err instanceof Error ? err.message : 'Could not use that picture.'))
            }}
          />
          <Button onClick={() => file.current?.click()} disabled={off}>
            {busy === 'upload' ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} {avatar ? 'Upload another' : 'Upload a picture'}
          </Button>
          {avatar && (
            <Button variant="ghost" className="hover:text-accent" onClick={() => void save('remove', () => null)} disabled={off}>
              <Trash2 className="size-4" /> Remove
            </Button>
          )}
        </div>
      </div>
      <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-widest text-muted">Or pick one</p>
      <div className="flex flex-wrap gap-2" data-default-pictures>
        {DEFAULT_AVATARS.map((d) => (
          <button
            key={d.id}
            type="button"
            title={d.label}
            aria-label={`${d.label} picture`}
            disabled={off}
            onClick={() => void save(d.id, () => defaultAvatar(d))}
            className={cn('flex size-11 items-center justify-center rounded-full text-xl ring-2 ring-transparent transition hover:-translate-y-0.5 hover:ring-accent/60 disabled:opacity-60')}
            style={{ background: `linear-gradient(135deg, ${d.from}, ${d.to})` }}
            data-default-picture={d.id}
          >
            {busy === d.id ? <Loader2 className="size-4 animate-spin text-white" /> : d.symbol}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="animate-pop-in mt-3 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
          {error}
        </p>
      )}
      {cropping && (
        <CropDialog
          img={cropping}
          onClose={() => setCropping(null)}
          onDone={(crop) => {
            const img = cropping
            setCropping(null)
            void save('upload', () => cropAvatar(img, crop))
          }}
        />
      )}
    </div>
  )
}
