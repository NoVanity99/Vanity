import { HeadphoneOff, Headphones, Mic, MicOff, PhoneOff } from 'lucide-react'
import type { Quality } from '@/voice/detect'
import { cn } from '@/lib/cn'

/** Three bars, like a phone's signal: how the call is doing. */
export function QualityBars({ quality, className }: { quality: Quality; className?: string }): React.JSX.Element {
  const lit = quality === 'good' ? 3 : quality === 'ok' ? 2 : quality === 'poor' ? 1 : 0
  const tone = quality === 'good' ? 'bg-emerald-400' : quality === 'ok' ? 'bg-amber-400' : quality === 'poor' ? 'bg-accent' : 'bg-white/25'
  return (
    <span className={cn('inline-flex h-3 items-end gap-[2px]', className)} role="img" aria-label={QUALITY_WORDS[quality]} data-quality={quality}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={cn('w-[3px] rounded-sm transition-colors', i < lit ? tone : 'bg-white/20')} style={{ height: `${(i + 1) * 4}px` }} />
      ))}
    </span>
  )
}

export const QUALITY_WORDS: Record<Quality, string> = { good: 'Good connection', ok: 'Okay connection', poor: 'Poor connection', unknown: 'Checking connection…' }

/** Mute, deafen and leave: the same three buttons in the voice bar and on the voice page. */
export function VoiceButtons({
  muted,
  deafened,
  micAvailable,
  onMute,
  onDeafen,
  onLeave,
  size = 'sm'
}: {
  muted: boolean
  deafened: boolean
  micAvailable: boolean
  onMute: () => void
  onDeafen: () => void
  onLeave: () => void
  size?: 'sm' | 'lg'
}): React.JSX.Element {
  const base = size === 'lg' ? 'size-12 rounded-2xl' : 'size-8 rounded-lg'
  const icon = size === 'lg' ? 'size-5' : 'size-4'
  return (
    <span className={cn('flex items-center', size === 'lg' ? 'gap-3' : 'gap-1')}>
      <button
        onClick={onMute}
        aria-pressed={muted}
        aria-label={muted ? 'Unmute' : 'Mute'}
        title={!micAvailable ? 'No microphone: listening only' : muted ? 'Unmute' : 'Mute'}
        data-voice-mute
        className={cn('flex items-center justify-center transition hover:brightness-125', base, muted ? 'bg-accent/20 text-accent' : 'bg-white/8 text-text hover:bg-white/15')}
      >
        {muted ? <MicOff className={icon} /> : <Mic className={icon} />}
      </button>
      <button
        onClick={onDeafen}
        aria-pressed={deafened}
        aria-label={deafened ? 'Undeafen' : 'Deafen'}
        title={deafened ? 'Undeafen' : "Deafen (you hear nothing and you're muted)"}
        data-voice-deafen
        className={cn('flex items-center justify-center transition hover:brightness-125', base, deafened ? 'bg-accent/20 text-accent' : 'bg-white/8 text-text hover:bg-white/15')}
      >
        {deafened ? <HeadphoneOff className={icon} /> : <Headphones className={icon} />}
      </button>
      <button onClick={onLeave} aria-label="Disconnect" title="Disconnect" data-voice-leave className={cn('flex items-center justify-center bg-accent text-white transition hover:brightness-110', base)}>
        <PhoneOff className={icon} />
      </button>
    </span>
  )
}
