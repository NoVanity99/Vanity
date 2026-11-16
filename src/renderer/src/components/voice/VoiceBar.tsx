import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useVoice, voice } from '@/state/voice'
import { QUALITY_WORDS, QualityBars, VoiceButtons } from './VoiceBits'

/**
 * The voice panel at the bottom of the sidebar while you're in a room: which room, how the
 * connection is, and your mute, deafen and leave buttons. It stays put as you move between pages;
 * click the room to open the voice page. `floating` is the small version shown when the sidebar
 * is hidden (and on phones).
 */
export function VoiceBar({ floating = false, className }: { floating?: boolean; className?: string }): React.JSX.Element | null {
  const v = useVoice()
  const navigate = useNavigate()
  const active = v.status === 'in-room' || v.status === 'reconnecting' || (v.status === 'connecting' && !!v.room)
  if (!active && !(v.status === 'connecting')) return null
  const others = v.members.filter((m) => !m.you)
  const talking = others.filter((m) => m.speaking)

  const status =
    v.status === 'reconnecting' ? (
      <span className="flex items-center gap-1.5 text-amber-300">
        <Loader2 className="size-3 animate-spin" /> Reconnecting…
      </span>
    ) : v.status === 'connecting' ? (
      <span className="flex items-center gap-1.5 text-muted">
        <Loader2 className="size-3 animate-spin" /> Connecting…
      </span>
    ) : (
      <span className="flex items-center gap-1.5 text-emerald-400" title={`${QUALITY_WORDS[v.quality]}${v.ping !== null ? `, ${v.ping} ms` : ''}`}>
        <QualityBars quality={v.quality} />
        Voice connected
        {v.ping !== null && <span className="tabular-nums text-muted">{v.ping} ms</span>}
      </span>
    )

  return (
    <div
      data-voice-bar={floating ? 'floating' : 'sidebar'}
      className={cn(
        'animate-pop-in rounded-xl border border-white/10 bg-black/35 p-2.5 backdrop-blur',
        floating && 'pointer-events-auto w-60 border-white/15 bg-surface/95 shadow-2xl shadow-black/60',
        className
      )}
    >
      <button onClick={() => navigate('/voice')} className="block w-full min-w-0 rounded-lg px-1 text-left transition hover:bg-white/5" title="Open the voice room">
        <span className="block text-[11px] font-semibold">{status}</span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
          <span className={cn('relative inline-flex size-2 shrink-0 rounded-full', v.speaking ? 'bg-emerald-400 shadow-[0_0_6px_rgb(52_211_153)]' : 'bg-white/20')} aria-label={v.speaking ? 'You are talking' : undefined} />
          <span className="truncate">
            {v.sharing ? <span className="font-semibold text-accent">Sharing your screen</span> : <span className="font-semibold text-text">{v.isHost ? 'Your room' : `${v.members.find((m) => m.host)?.user.username ?? 'Friend'}'s room`}</span>}
            {' · '}
            {talking.length ? <span className="text-emerald-400">{talking.map((m) => m.user.username).join(', ')} talking</span> : `${others.length} other${others.length === 1 ? '' : 's'}`}
          </span>
        </span>
      </button>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex -space-x-1.5 overflow-hidden pl-1">
          {v.members.slice(0, 5).map((m) => (
            <span key={m.id} className={cn('size-5 rounded-full ring-2 transition', m.speaking ? 'ring-emerald-400' : 'ring-surface')} title={m.user.username}>
              {m.user.avatar ? (
                <img src={m.user.avatar} alt="" className="size-full rounded-full object-cover" />
              ) : (
                <span className="flex size-full items-center justify-center rounded-full bg-white/15 text-[8px] font-bold">{m.user.username.slice(0, 2).toUpperCase()}</span>
              )}
            </span>
          ))}
        </span>
        <VoiceButtons muted={v.muted} deafened={v.deafened} micAvailable={v.micAvailable} onMute={() => voice.toggleMute()} onDeafen={() => voice.toggleDeafen()} onLeave={() => voice.leave()} />
      </div>
    </div>
  )
}
