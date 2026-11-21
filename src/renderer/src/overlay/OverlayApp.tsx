import { useEffect, useState } from 'react'
import { AudioLines, Gamepad2, HeadphoneOff, MessageCircle, MicOff, UserPlus, Wifi } from 'lucide-react'
import { OVERLAY_LAYOUT, type OverlayKind, type OverlayState } from '@shared/overlay'
import { Avatar } from '@/components/Avatar'
import { cn } from '@/lib/cn'

const NOTE_ICONS = { online: Wifi, playing: Gamepad2, message: MessageCircle, voice: AudioLines, request: UserPlus } as const

/**
 * What is drawn over a running game: either the people in your voice room, or notifications.
 * Each is a small see-through window of its own (src/main/overlay). Nothing here can be clicked:
 * the mouse goes straight through to the game.
 */
export function OverlayApp({ kind }: { kind: OverlayKind }): React.JSX.Element | null {
  const [state, setState] = useState<OverlayState | null>(null)
  useEffect(() => {
    window.vanity.overlay.state().then((s) => s && setState(s), () => {})
    return window.vanity.overlay.onState(setState)
  }, [])
  if (!state) return null
  const right = state.corner.endsWith('right')
  const bottom = state.corner.startsWith('bottom')

  if (kind === 'voice') {
    const talking = new Set(state.speaking)
    return (
      <div className={cn('flex h-full flex-col', right ? 'items-end' : 'items-start', bottom ? 'justify-end' : 'justify-start')} style={{ padding: OVERLAY_LAYOUT.voice.pad }} data-overlay="voice" data-corner={state.corner}>
        {state.members.map((m) => {
          const on = talking.has(m.id) && !m.muted
          return (
            <div key={m.id} className={cn('flex items-center gap-2', right && 'flex-row-reverse')} style={{ height: OVERLAY_LAYOUT.voice.row }} data-overlay-member={m.name} data-speaking={on}>
              <span className={cn('overlay-voice relative rounded-full', on && 'overlay-speaking')}>
                <Avatar name={m.name || '?'} src={m.avatar} size="md" className={cn('transition-opacity', !on && 'opacity-70')} />
                {(m.deafened || m.muted) && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-black/85 text-red-300 ring-1 ring-white/20">{m.deafened ? <HeadphoneOff className="size-2.5" /> : <MicOff className="size-2.5" />}</span>
                )}
              </span>
              {/* The name shows while they talk, so you know whose ring it is. */}
              <span className={cn('max-w-[150px] truncate rounded-md bg-black/70 px-2 py-0.5 text-xs font-semibold text-white shadow transition-opacity duration-150', on ? 'opacity-100' : 'opacity-0')}>{m.name}</span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={cn('flex h-full flex-col gap-2', bottom ? 'justify-end' : 'justify-start')} style={{ padding: OVERLAY_LAYOUT.notes.pad }} data-overlay="notes" data-corner={state.corner}>
      {state.notes.map((n) => {
        const Icon = NOTE_ICONS[n.kind]
        return (
          <div key={n.id} role="status" className={cn('overlay-note flex items-center gap-3 rounded-2xl border border-white/15 bg-[#12141b]/90 p-3 text-white shadow-xl shadow-black/50', right ? 'overlay-note-right' : 'overlay-note-left')} data-overlay-note={n.kind}>
            <Avatar name={n.name || '?'} src={n.avatar} size="md" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm">
                <Icon className="size-3.5 shrink-0 text-emerald-400" />
                <span className="truncate font-bold">{n.name}</span>
              </span>
              <span className="block truncate text-xs text-white/75">{n.action}</span>
              {n.detail && <span className="mt-0.5 line-clamp-2 block text-xs text-white/90">{n.detail}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}
