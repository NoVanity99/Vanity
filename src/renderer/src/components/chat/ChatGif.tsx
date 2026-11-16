import { useEffect, useState } from 'react'
import { ImageOff, Loader2 } from 'lucide-react'
import type { GifRef } from '@shared/groups'
import { cn } from '@/lib/cn'

/** A GIF inside a chat message: from KLIPY (by address) or uploaded from someone's device (by id). */
export function ChatGif({ gif, className }: { gif: GifRef; className?: string }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(gif.kind === 'url' ? gif.url : null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (gif.kind !== 'media') return
    let alive = true
    setSrc(null)
    setFailed(false)
    void window.vanity.gifs.media(gif.id).then(
      (r) => {
        if (!alive) return
        if (r.error !== undefined) setFailed(true)
        else setSrc(r.data)
      },
      () => alive && setFailed(true)
    )
    return () => {
      alive = false
    }
  }, [gif.kind === 'media' ? gif.id : gif.url]) // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) {
    return (
      <span className={cn('flex h-24 w-40 items-center justify-center gap-2 rounded-xl bg-white/5 text-xs text-muted', className)}>
        <ImageOff className="size-4" /> GIF unavailable
      </span>
    )
  }
  if (!src) {
    return (
      <span className={cn('flex h-24 w-40 items-center justify-center rounded-xl bg-white/5', className)}>
        <Loader2 className="size-4 animate-spin text-muted" />
      </span>
    )
  }
  return <img src={src} alt="GIF" loading="lazy" draggable={false} onError={() => setFailed(true)} className={cn('max-h-60 max-w-[240px] rounded-xl object-contain', className)} data-chat-gif />
}
