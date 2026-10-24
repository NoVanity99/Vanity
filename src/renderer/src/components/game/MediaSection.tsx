import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Images, Play, X } from 'lucide-react'
import type { GameDetails } from '@shared/types'
import { useGamepadHandler } from '@/gamepad/GamepadLayer'
import { Section } from './parts'

type Shot = GameDetails['screenshots'][number]

/** Full-screen screenshot viewer: arrows, mouse or controller to flip, Escape or B to close. */
function Lightbox({ shots, index, onIndex, onClose }: { shots: Shot[]; index: number; onIndex: (i: number) => void; onClose: () => void }): React.JSX.Element {
  const step = useCallback((d: number) => onIndex((index + d + shots.length) % shots.length), [index, onIndex, shots.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, step])

  useGamepadHandler(
    useCallback(
      (a) => {
        if (a === 'left' || a === 'prevTab') step(-1)
        else if (a === 'right' || a === 'nextTab') step(1)
        else if (a === 'back' || a === 'confirm') onClose()
        // Up/down would move focus behind the viewer; swallow them. Everything else passes through.
        else if (a !== 'up' && a !== 'down') return false
        return true
      },
      [step, onClose]
    )
  )

  return createPortal(
    <div
      role="dialog"
      aria-label="Screenshot"
      className="fixed inset-0 z-50 flex animate-[fade-in_150ms_ease-out] items-center justify-center bg-black/90 backdrop-blur"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <img key={index} src={shots[index].full} alt="" className="animate-pop-in max-h-[88vh] max-w-[90vw] rounded-xl shadow-2xl" draggable={false} />
      <button onClick={onClose} aria-label="Close" className="absolute right-6 top-12 rounded-full bg-white/10 p-2.5 hover:bg-white/20">
        <X className="size-5" />
      </button>
      {shots.length > 1 && (
        <>
          <button onClick={() => step(-1)} aria-label="Previous" className="absolute left-6 rounded-full bg-white/10 p-3 hover:bg-white/20">
            <ChevronLeft className="size-6" />
          </button>
          <button onClick={() => step(1)} aria-label="Next" className="absolute right-6 rounded-full bg-white/10 p-3 hover:bg-white/20">
            <ChevronRight className="size-6" />
          </button>
          <p className="absolute bottom-6 rounded-full bg-black/60 px-3 py-1 text-xs tabular-nums text-white/80">
            {index + 1} / {shots.length}
          </p>
        </>
      )}
    </div>,
    document.body
  )
}

export function MediaSection({ shots, videos, delay }: { shots: Shot[]; videos: GameDetails['videos']; delay?: number }): React.JSX.Element | null {
  const [open, setOpen] = useState<number | null>(null)
  if (shots.length === 0 && videos.length === 0) return null
  return (
    <Section icon={Images} title="Media" delay={delay} action={<span className="text-xs text-muted">{shots.length} screenshots{videos.length ? ` · ${videos.length} videos` : ''}</span>}>
      {videos.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
          {videos.map((v) => (
            <a
              key={v.id}
              href={`https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`}
              target="_blank"
              rel="noreferrer"
              title={`Watch "${v.name}" on YouTube`}
              className="group relative aspect-video overflow-hidden rounded-xl bg-surface-2 ring-1 ring-white/5 transition hover:-translate-y-0.5 hover:ring-white/25"
            >
              <img src={`https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/hqdefault.jpg`} alt="" loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-105" draggable={false} />
              <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              <span className="absolute left-1/2 top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent shadow-lg shadow-black/40 transition group-hover:scale-110">
                <Play className="ml-0.5 size-5 fill-white text-white" />
              </span>
              <span className="absolute inset-x-3 bottom-2 truncate text-xs font-semibold text-white">{v.name}</span>
            </a>
          ))}
        </div>
      )}
      {shots.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {shots.map((s, i) => (
            <button
              key={s.full}
              onClick={() => setOpen(i)}
              className={`group overflow-hidden rounded-xl bg-surface-2 ring-1 ring-white/5 transition hover:ring-white/25 ${i === 0 ? 'col-span-2 row-span-2' : ''}`}
              aria-label={`Screenshot ${i + 1}`}
            >
              <img src={i === 0 ? s.full : s.thumb} alt="" loading="lazy" className="aspect-video size-full object-cover transition duration-500 group-hover:scale-105" draggable={false} />
            </button>
          ))}
        </div>
      )}
      {open !== null && <Lightbox shots={shots} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </Section>
  )
}
