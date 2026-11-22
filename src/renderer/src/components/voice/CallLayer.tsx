import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { MonitorUp, Phone, PhoneOff, Users, X } from 'lucide-react'
import { dmChat, type VoiceUser } from '@shared/voiceProtocol'
import type { ProfileStyle } from '@shared/profileStyle'
import { Avatar } from '@/components/Avatar'
import { Button, Dialog } from '@/components/Dialog'
import { UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { startRinging } from '@/lib/chime'
import { dismissCall, usePulse } from '@/state/pulse'
import { useToast } from '@/state/toasts'
import { onStreamStart, useVoice, voice } from '@/state/voice'

const styleOf = (u: VoiceUser): Partial<ProfileStyle> | undefined => (u.style && typeof u.style === 'object' ? (u.style as Partial<ProfileStyle>) : undefined)

/**
 * Mounted once: the pop-up when a call rings for you (with accept and decline), and the note when
 * someone in your call starts sharing their screen ("… started streaming — Watch").
 */
export function CallLayer(): React.JSX.Element | null {
  const calls = usePulse().calls
  const v = useVoice()
  const navigate = useNavigate()
  const toast = useToast()
  // A call you're already in doesn't ring.
  const call = calls.find((c) => c.roomId !== v.room?.id) ?? null
  const [streams, setStreams] = useState<{ key: number; id: string; user: VoiceUser; leaving?: boolean }[]>([])
  const nextKey = useRef(1)

  // Ring while a call is waiting.
  const ringing = call ? `${call.roomId}:${call.at}` : null
  useEffect(() => (ringing ? startRinging() : undefined), [ringing])

  useEffect(
    () =>
      onStreamStart((member) => {
        const key = nextKey.current++
        setStreams((list) => [...list.slice(-2), { key, ...member }])
        setTimeout(() => setStreams((list) => list.map((s) => (s.key === key ? { ...s, leaving: true } : s))), 9700)
        setTimeout(() => setStreams((list) => list.filter((s) => s.key !== key)), 10_000)
      }),
    []
  )

  const answer = async (): Promise<void> => {
    if (!call) return
    dismissCall(call)
    navigate('/voice')
    await voice.join(call.roomId).catch((err: unknown) => toast(err instanceof Error ? err.message : "Couldn't join the call.", 'error'))
  }
  const decline = (): void => {
    if (!call) return
    dismissCall(call)
    void window.vanity.account.request('POST', `/voice/rings/${call.roomId}/decline`).catch(() => {})
  }

  return createPortal(
    <>
      {call && (
        <div className="pointer-events-none fixed inset-x-0 top-12 z-[58] flex justify-center px-4 max-md:top-[calc(3.5rem+env(safe-area-inset-top))]" data-incoming-call={call.from.username}>
          <div role="alertdialog" aria-label={`${call.from.username} is calling`} className="pointer-events-auto relative w-full max-w-sm animate-[dialog-in_220ms_ease-out] overflow-clip rounded-3xl border border-emerald-400/40 bg-surface shadow-2xl shadow-black/70">
            <span aria-hidden className="profile-banner" data-banner={styleOf(call.from)?.banner ?? 'default'} data-fx={styleOf(call.from)?.effect ?? 'none'} />
            <div className="relative flex items-center gap-4 p-5">
              <span className="call-ringing rounded-full">
                <Avatar name={call.from.username} src={call.from.avatar} frame={styleOf(call.from)?.frame} size="lg" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                  <Phone className="size-3" /> Incoming call
                </p>
                <p className="truncate text-lg font-bold">
                  <UserName name={call.from.username} style={styleOf(call.from)} verified={call.from.verified} admin={call.from.admin} />
                </p>
                <p className="truncate text-xs text-muted">{call.group ? `is calling ${call.group.name}` : 'is calling you'}</p>
              </div>
            </div>
            <div className="relative grid grid-cols-2 gap-2 px-5 pb-5">
              <Button className="h-11 border-accent/40 text-accent hover:bg-accent/15" onClick={decline} data-call-decline>
                <PhoneOff className="size-4" /> Decline
              </Button>
              <Button className="h-11 border-0 bg-emerald-500 font-semibold text-white hover:bg-emerald-400" onClick={() => void answer()} data-call-accept>
                <Phone className="size-4" /> Accept
              </Button>
            </div>
          </div>
        </div>
      )}

      {streams.length > 0 && (
        <div className="pointer-events-none fixed right-6 z-[59] flex flex-col items-end gap-2 max-md:inset-x-3 max-md:items-stretch" style={{ bottom: 'calc(5rem + var(--chat-dock-h, 0px))' }}>
          {streams.map((s) => (
            <div key={s.key} role="status" className={cn('pointer-events-auto flex items-center gap-3 rounded-2xl border border-accent/40 bg-surface-2/95 py-2.5 pl-3 pr-2 shadow-2xl backdrop-blur', s.leaving ? 'animate-[toast-out_240ms_ease-in_forwards]' : 'animate-[toast-in_220ms_cubic-bezier(0.2,0.7,0.2,1)]')} data-stream-alert={s.user.username}>
              <Avatar name={s.user.username} src={s.user.avatar} size="sm" />
              <span className="min-w-0 text-sm">
                <span className="font-bold">{s.user.username}</span> started streaming
              </span>
              <Button
                variant="primary"
                className="h-8 px-3 text-xs"
                onClick={() => {
                  setStreams((list) => list.filter((x) => x.key !== s.key))
                  voice.watch(s.id)
                  navigate('/voice')
                }}
                data-stream-watch
              >
                <MonitorUp className="size-3.5" /> Watch
              </Button>
              <button onClick={() => setStreams((list) => list.filter((x) => x.key !== s.key))} aria-label="Dismiss" className="rounded-full p-1 text-muted transition hover:bg-white/10 hover:text-text">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>,
    document.body
  )
}

/** The call button in a chat's header: calls that friend or group, or shows that its call is on. */
export function CallButton({ friendId, groupId, myId, className }: { friendId?: string; groupId?: string; myId?: string; className?: string }): React.JSX.Element {
  const v = useVoice()
  const toast = useToast()
  const navigate = useNavigate()
  const chat = groupId ? `group:${groupId}` : friendId && myId ? dmChat(myId, friendId) : null
  const here = !!chat && v.room?.chat === chat && v.status !== 'idle' && v.status !== 'error'
  const busy = v.status === 'connecting'
  return (
    <button
      onClick={() => {
        if (here) return navigate('/voice')
        void voice.call(groupId ? { groupId } : { friendId }).then(() => {
          const err = voice.snapshot.error
          if (err) toast(err.message, 'error')
        })
      }}
      disabled={busy}
      aria-label={here ? 'Open the call' : groupId ? 'Call the group' : 'Call'}
      title={here ? "You're in this call: open it" : groupId ? 'Call everyone in this group' : 'Voice call'}
      className={cn(className, here && 'bg-emerald-500/20 text-emerald-400')}
      data-call-button={here ? 'in-call' : 'call'}
    >
      <Phone className="size-4" />
    </button>
  )
}

/**
 * Who is watching a shared screen: small round pictures that overlap a little, "+N" when there
 * are more than fit (click it for everyone). Updates as people start and stop watching.
 */
export function ViewerStack({ sharerId, max = 5, className }: { sharerId: string; max?: number; className?: string }): React.JSX.Element | null {
  const v = useVoice()
  const [open, setOpen] = useState(false)
  const viewers = v.members.filter((m) => m.watching === sharerId && m.id !== sharerId)
  if (!viewers.length) return null
  const shown = viewers.slice(0, viewers.length > max ? max - 1 : max)
  const extra = viewers.length - shown.length
  return (
    <>
      <div className={cn('flex items-center', className)} data-viewers={viewers.length} aria-label={`${viewers.length} watching`}>
        {shown.map((m, i) => (
          <span key={m.id} title={m.you ? `${m.user.username} (you)` : m.user.username} className={cn('rounded-full ring-2 ring-black/80 transition hover:z-10 hover:-translate-y-0.5', i > 0 && '-ml-2')} data-viewer={m.user.username}>
            <Avatar name={m.user.username} src={m.user.avatar} size="sm" className="[&>span]:ring-0" />
          </span>
        ))}
        {extra > 0 && (
          <button onClick={() => setOpen(true)} className="-ml-2 flex size-7 items-center justify-center rounded-full bg-surface-2 text-[10px] font-bold text-text ring-2 ring-black/80 transition hover:bg-accent hover:text-white" title="See everyone watching" data-viewers-more>
            +{extra}
          </button>
        )}
        <button onClick={() => setOpen(true)} className="ml-2 text-xs font-semibold text-white/80 transition hover:text-white" data-viewers-count>
          {viewers.length} watching
        </button>
      </div>
      {open && (
        <Dialog title="Watching now" description={`${viewers.length} ${viewers.length === 1 ? 'person is' : 'people are'} watching this stream.`} onClose={() => setOpen(false)}>
          <ul className="space-y-1 p-4" data-viewer-list>
            {viewers.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                <Avatar name={m.user.username} src={m.user.avatar} frame={styleOf(m.user)?.frame} size="sm" />
                <UserName name={m.user.username} style={styleOf(m.user)} verified={m.user.verified} admin={m.user.admin} className="min-w-0 flex-1 text-sm font-semibold" />
                {m.you && <span className="text-xs text-muted">You</span>}
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </>
  )
}

/** "Ringing bob, cal…" while a call you started hasn't been answered by everyone. */
export function RingingNote(): React.JSX.Element | null {
  const ringing = useVoice().room?.ringing ?? []
  if (!ringing.length) return null
  return (
    <p className="flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-sm text-emerald-200" data-ringing={ringing.map((r) => r.username).join(',')}>
      <span className="call-ringing flex size-6 items-center justify-center rounded-full bg-emerald-500/30">
        <Phone className="size-3.5" />
      </span>
      Ringing {ringing.slice(0, 4).map((r) => r.username).join(', ')}
      {ringing.length > 4 ? ` and ${ringing.length - 4} more` : ''}…
      <Users className="ml-auto size-4 opacity-60" />
    </p>
  )
}
