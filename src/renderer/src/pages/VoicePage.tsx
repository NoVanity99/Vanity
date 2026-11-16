import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, AudioLines, Check, Copy, HeadphoneOff, Loader2, MicOff, MoreHorizontal, Plus, RefreshCw, Send, Settings2, UserPlus, Users, Volume2, VolumeX, WifiOff, X } from 'lucide-react'
import { MAX_ROOM_SIZE } from '@shared/voiceProtocol'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Dialog'
import { UserName } from '@/components/UserName'
import { QUALITY_WORDS, QualityBars, VoiceButtons } from '@/components/voice/VoiceBits'
import { cn } from '@/lib/cn'
import { isAndroid } from '@/lib/platform'
import { savePref } from '@/lib/storage'
import { useAccount } from '@/state/account'
import { useSettings } from '@/state/settings'
import { useFriends } from '@/state/friends'
import { useToast } from '@/state/toasts'
import { useVoice, voice, voiceSettings } from '@/state/voice'
import type { VoiceMember } from '@/voice/client'

/** Opens Settings on the Voice tab. */
export function openVoiceSettings(navigate: (to: string) => void): void {
  savePref('settings-tab', { tab: 'voice' })
  navigate('/settings')
}

/** The text an invite sends in a chat; the chat turns it into a Join button. */
export const inviteText = (code: string): string => `🎧 Join my voice room in Vanity: ${code}`

/** One person in the room: their picture with the green talking ring, name, and mute/deafen marks. */
function MemberTile({ m, index, onMenu }: { m: VoiceMember; index: number; onMenu: (m: VoiceMember, x: number, y: number) => void }): React.JSX.Element {
  const quiet = !m.you && (m.localMuted || m.volume === 0)
  return (
    <li
      style={{ '--i': index } as React.CSSProperties}
      data-member={m.user.username}
      data-speaking-member={m.speaking}
      onContextMenu={(e) => {
        if (m.you) return
        e.preventDefault()
        onMenu(m, e.clientX, e.clientY)
      }}
      className={cn(
        'animate-card-in group relative flex flex-col items-center overflow-clip rounded-3xl border bg-surface px-4 pb-5 pt-7 text-center transition-colors duration-300',
        m.speaking ? 'border-emerald-400/60' : 'border-border',
        !m.connected && 'opacity-60'
      )}
    >
      <span aria-hidden className="profile-banner opacity-60" data-banner={(m.user.style as { banner?: string } | null)?.banner ?? 'default'} />
      <span className="relative inline-flex" data-speaking={m.speaking}>
        <Avatar name={m.user.username} src={m.user.avatar} frame={(m.user.style as { frame?: string } | null)?.frame} size="xl" />
        <span aria-hidden className="voice-ring" />
        {(m.muted || m.deafened) && (
          <span className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-surface text-accent ring-2 ring-surface" title={m.deafened ? 'Deafened' : 'Muted'}>
            {m.deafened ? <HeadphoneOff className="size-3.5" /> : <MicOff className="size-3.5" />}
          </span>
        )}
      </span>
      <span className="relative mt-4 max-w-full text-base font-semibold">
        <UserName name={m.user.username} style={m.user.style as never} verified={m.user.verified} admin={m.user.admin} className="justify-center" />
      </span>
      <span className="relative mt-1 flex min-h-5 items-center gap-1.5 text-xs text-muted">
        {m.you ? (
          'You'
        ) : !m.connected ? (
          <>
            <Loader2 className="size-3 animate-spin" /> Reconnecting…
          </>
        ) : m.link && m.link.state !== 'connected' ? (
          <>
            <Loader2 className="size-3 animate-spin" /> Connecting…
          </>
        ) : (
          <>
            <QualityBars quality={m.link?.quality ?? 'unknown'} />
            {m.link?.rttMs != null && <span className="tabular-nums">{m.link.rttMs} ms</span>}
            {quiet ? <VolumeX className="ml-1 size-3.5 text-accent" aria-label="Muted for you" /> : m.volume !== 1 && <span className="ml-1 tabular-nums">{Math.round(m.volume * 100)}%</span>}
          </>
        )}
      </span>
      {!m.you && (
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onMenu(m, r.left, r.bottom + 4)
          }}
          aria-label={`Volume for ${m.user.username}`}
          title="Volume (or right-click)"
          className="absolute right-2 top-2 rounded-lg p-1.5 text-muted opacity-0 transition hover:bg-white/10 hover:text-text group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </button>
      )}
    </li>
  )
}

/** Right-click on someone: their volume for you (0–200%), or mute them for yourself. */
function VolumeMenu({ m, x, y, onClose }: { m: VoiceMember; x: number; y: number; onClose: () => void }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useEffect(() => {
    // Keep it on screen.
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) })
  }, [x, y])
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) onClose()
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
  const pct = Math.round(m.volume * 100)
  return (
    <div ref={box} role="menu" data-volume-menu style={{ left: pos.x, top: pos.y }} className="animate-pop-in fixed z-[70] w-64 rounded-2xl border border-white/15 bg-surface p-4 shadow-2xl shadow-black/60">
      <p className="truncate text-sm font-semibold">{m.user.username}</p>
      <label className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>Volume for you</span>
        <span className="font-semibold tabular-nums text-text" data-volume-value>
          {pct}%
        </span>
      </label>
      <div className="mt-2 flex items-center gap-2">
        <VolumeX className="size-4 shrink-0 text-muted" />
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={pct}
          onChange={(e) => voice.setPeerVolume(m.id, Number(e.target.value) / 100)}
          aria-label={`Volume for ${m.user.username}`}
          className="w-full accent-[var(--color-accent)]"
        />
        <Volume2 className="size-4 shrink-0 text-muted" />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted/70">
        <span>0%</span>
        <span>100%</span>
        <span>200%</span>
      </div>
      <button
        role="menuitemcheckbox"
        aria-checked={m.localMuted}
        onClick={() => voice.setPeerMuted(m.id, !m.localMuted)}
        className={cn('mt-3 flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition', m.localMuted ? 'bg-accent/15 text-accent' : 'bg-white/5 hover:bg-white/10')}
        data-local-mute
      >
        <span className="flex items-center gap-2">
          <VolumeX className="size-4" /> Mute for me
        </span>
        {m.localMuted && <Check className="size-4" />}
      </button>
      {(pct !== 100 || m.localMuted) && (
        <button
          onClick={() => {
            voice.setPeerMuted(m.id, false)
            voice.setPeerVolume(m.id, 1)
          }}
          className="mt-1.5 w-full rounded-lg px-3 py-1.5 text-xs text-muted transition hover:bg-white/5 hover:text-text"
        >
          Back to normal
        </button>
      )}
      <p className="mt-2 text-[11px] leading-snug text-muted">Only changes what you hear. Remembered for next time.</p>
    </div>
  )
}

/** Invite a friend: sends them a chat message with the room code, which shows a Join button. */
function InviteMenu({ code, onClose }: { code: string; onClose: () => void }): React.JSX.Element {
  const friends = useFriends()
  const toast = useToast()
  const [sent, setSent] = useState<Set<string>>(new Set())
  const list = [...(friends?.friends ?? [])].sort((a, b) => Number(b.status.state !== 'offline') - Number(a.status.state !== 'offline') || a.username.localeCompare(b.username))
  return (
    <div className="animate-pop-in absolute right-0 top-full z-30 mt-2 w-72 rounded-2xl border border-white/15 bg-surface p-2 shadow-2xl shadow-black/60" data-invite-menu>
      <div className="flex items-center justify-between px-2 py-1.5">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Invite a friend</p>
        <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-white/10 hover:text-text">
          <X className="size-3.5" />
        </button>
      </div>
      {list.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted">{friends ? 'No friends yet. Share the code instead.' : 'Sign in to invite friends. You can still share the code.'}</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto [scrollbar-width:thin]">
          {list.map((f) => (
            <li key={f.id}>
              <button
                disabled={sent.has(f.id)}
                onClick={async () => {
                  const r = await window.vanity.friends.send(f.id, inviteText(code)).catch(() => null)
                  if (!r || r.error !== undefined) return toast(r?.error ?? "Couldn't send the invite.", 'error')
                  setSent((s) => new Set(s).add(f.id))
                  toast(`Invite sent to ${f.username}`)
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/5 disabled:opacity-60"
              >
                <Avatar name={f.username} src={f.avatar} size="sm" status={f.status.state} />
                <span className="min-w-0 flex-1 truncate text-sm">{f.username}</span>
                {sent.has(f.id) ? <Check className="size-4 text-emerald-400" /> : <Send className="size-3.5 text-muted" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function VoicePage(): React.JSX.Element {
  const v = useVoice()
  const account = useAccount()
  const navigate = useNavigate()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [menu, setMenu] = useState<{ m: VoiceMember; x: number; y: number } | null>(null)
  const [inviting, setInviting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hasServer, setHasServer] = useState<boolean | null>(null)
  const phone = isAndroid()
  const busy = v.status === 'connecting'
  const inRoom = v.status === 'in-room' || v.status === 'reconnecting' || (busy && !!v.code)
  const vs = useSettings()?.voice ?? voiceSettings()
  const ptt = vs.inputMode === 'ptt'

  useEffect(() => {
    void window.vanity.voice.serverUrl().then((r) => setHasServer(!!r.url), () => setHasServer(false))
  }, [])
  // The member the volume menu is for, kept current (their volume changes while it's open).
  const menuMember = menu ? (v.members.find((m) => m.id === menu.m.id) ?? null) : null

  const copy = async (): Promise<void> => {
    if (!v.code) return
    await navigator.clipboard.writeText(v.code).catch(() => {})
    setCopied(true)
    toast('Room code copied')
    setTimeout(() => setCopied(false), 1500)
  }

  const signedOut = account !== null && (!account.signedIn || !account.username)

  return (
    <div className="h-full overflow-y-auto" data-voice-page>
      <div className="mx-auto w-full max-w-6xl space-y-6 px-10 pb-16 pt-12 max-md:px-4 max-md:pt-14">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
              <AudioLines className="size-7 text-accent" /> Voice
            </h1>
            <p className="mt-1 text-sm text-muted">Talk with friends while you play. Rooms hold up to {MAX_ROOM_SIZE} people; share the code to bring someone in.</p>
          </div>
          <Button onClick={() => openVoiceSettings(navigate)}>
            <Settings2 className="size-4" /> Voice settings
          </Button>
        </div>

        {v.error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm" data-voice-error={v.error.code}>
            {v.error.code === 'unreachable' ? <WifiOff className="size-5 shrink-0 text-accent" /> : <AlertTriangle className="size-5 shrink-0 text-accent" />}
            <span className="min-w-0 flex-1">{v.error.message}</span>
            {v.error.code === 'not-configured' ? (
              <Button variant="primary" onClick={() => openVoiceSettings(navigate)}>
                Open voice settings
              </Button>
            ) : v.error.code === 'signed-out' ? (
              <Button variant="primary" onClick={() => navigate('/account')}>
                Sign in
              </Button>
            ) : v.error.code === 'unreachable' || v.error.code === 'server' ? (
              <Button onClick={() => (v.code ? voice.retry() : voice.dismissNotice())}>
                <RefreshCw className="size-4" /> {v.code ? 'Try again' : 'OK'}
              </Button>
            ) : (
              <button onClick={() => voice.dismissNotice()} aria-label="Dismiss" className="rounded p-1 text-muted hover:text-text">
                <X className="size-4" />
              </button>
            )}
          </div>
        )}
        {v.notice && (
          <div role="status" className="flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100" data-voice-notice>
            <AlertTriangle className="size-5 shrink-0 text-amber-300" />
            <span className="min-w-0 flex-1">{v.notice}</span>
            <button onClick={() => voice.dismissNotice()} aria-label="Dismiss" className="rounded p-1 text-amber-200/70 hover:text-amber-100">
              <X className="size-4" />
            </button>
          </div>
        )}

        {!inRoom ? (
          signedOut ? (
            <div className="rounded-3xl border border-border bg-surface p-8 text-center">
              <p className="text-sm text-muted">Sign in to your Vanity account to use voice rooms: your friends see your name and picture.</p>
              <Button variant="primary" className="mt-4" onClick={() => navigate('/account')}>
                Go to Account
              </Button>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <section className="relative overflow-clip rounded-3xl border border-border bg-surface p-7">
                <span aria-hidden className="profile-banner opacity-70" data-banner="aurora" />
                <div className="relative">
                  <h2 className="text-xl font-bold">Start a room</h2>
                  <p className="mt-1 text-sm text-muted">Get a code to share with friends. The room lasts while anyone is in it.</p>
                  <Button variant="primary" className="mt-6 h-12 px-6 text-base" onClick={() => void voice.create()} disabled={busy || hasServer === false} data-voice-create>
                    {busy && !v.code ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />} {busy && !v.code ? 'Starting…' : 'Start a room'}
                  </Button>
                </div>
              </section>
              <section className="rounded-3xl border border-border bg-surface p-7">
                <h2 className="text-xl font-bold">Join a room</h2>
                <p className="mt-1 text-sm text-muted">Type the 6-character code a friend shared.</p>
                <form
                  className="mt-6 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (code.trim()) void voice.join(code)
                  }}
                >
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="K7M2QX"
                    aria-label="Room code"
                    maxLength={9}
                    spellCheck={false}
                    autoCapitalize="characters"
                    className="h-12 min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-4 text-center font-mono text-lg tracking-[0.35em] outline-none transition placeholder:text-muted/50 focus:border-accent focus:ring-4 focus:ring-accent/15"
                    data-voice-code
                  />
                  <Button type="submit" variant="primary" className="h-12 px-5" disabled={busy || !code.trim() || hasServer === false} data-voice-join>
                    {busy && v.code ? <Loader2 className="size-4 animate-spin" /> : 'Join'}
                  </Button>
                </form>
              </section>
              {hasServer === false && (
                <p className="text-sm text-muted md:col-span-2">
                  Voice needs a voice server address first.{' '}
                  <button onClick={() => openVoiceSettings(navigate)} className="font-semibold text-accent hover:underline">
                    Add one in Voice settings
                  </button>
                  .
                </p>
              )}
            </div>
          )
        ) : (
          <>
            <section className="flex flex-wrap items-center gap-4 rounded-3xl border border-border bg-surface p-5" data-voice-room>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted">Room code</p>
                <div className="mt-1 flex items-center gap-3">
                  <span className="font-mono text-3xl font-black tracking-[0.25em]" data-voice-room-code>
                    {v.code ?? '······'}
                  </span>
                  {v.code && (
                    <button onClick={() => void copy()} aria-label="Copy the code" title="Copy the code" className="rounded-lg p-2 text-muted transition hover:bg-white/10 hover:text-text">
                      {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {v.status === 'reconnecting' ? (
                  <span className="flex items-center gap-2 text-amber-300" data-voice-status="reconnecting">
                    <Loader2 className="size-4 animate-spin" /> Reconnecting{v.attempt > 1 ? ` (try ${v.attempt})` : ''}…
                    <button onClick={() => voice.retry()} className="font-semibold underline-offset-4 hover:underline">
                      Now
                    </button>
                  </span>
                ) : v.status === 'connecting' ? (
                  <span className="flex items-center gap-2 text-muted">
                    <Loader2 className="size-4 animate-spin" /> Connecting…
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-muted" data-voice-status="connected">
                    <QualityBars quality={v.quality} /> {QUALITY_WORDS[v.quality]}
                    {v.ping !== null && <span className="tabular-nums">· {v.ping} ms</span>}
                  </span>
                )}
              </div>
              <div className="relative">
                <Button onClick={() => setInviting((x) => !x)} disabled={!v.code} data-voice-invite>
                  <UserPlus className="size-4" /> Invite
                </Button>
                {inviting && v.code && <InviteMenu code={v.code} onClose={() => setInviting(false)} />}
              </div>
            </section>

            <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4" data-voice-members>
              {v.members.map((m, i) => (
                <MemberTile key={m.id} m={m} index={i} onMenu={(mm, x, y) => setMenu({ m: mm, x, y })} />
              ))}
              {v.members.length === 1 && v.status === 'in-room' && (
                <li className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
                  <Users className="mb-2 size-6 opacity-50" />
                  It's just you. Share the code or invite a friend.
                </li>
              )}
            </ul>

            <div className="sticky bottom-4 mx-auto flex w-fit items-center gap-4 rounded-3xl border border-white/10 bg-surface/90 px-5 py-3 shadow-2xl shadow-black/50 backdrop-blur" data-voice-controls>
              <VoiceButtons size="lg" muted={v.muted} deafened={v.deafened} micAvailable={v.micAvailable} onMute={() => voice.toggleMute()} onDeafen={() => voice.toggleDeafen()} onLeave={() => voice.leave()} />
              {ptt && (
                <button
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    voice.pushToTalk(true)
                  }}
                  onPointerUp={() => voice.pushToTalk(false)}
                  onPointerCancel={() => voice.pushToTalk(false)}
                  onContextMenu={(e) => e.preventDefault()}
                  disabled={v.muted || !v.micAvailable}
                  data-voice-ptt
                  className={cn(
                    'h-12 select-none rounded-2xl px-5 text-sm font-bold transition touch-none disabled:opacity-40',
                    v.pushToTalk ? 'scale-95 bg-emerald-500 text-white shadow-lg shadow-emerald-500/40' : 'bg-white/10 text-text hover:bg-white/15'
                  )}
                >
                  {v.pushToTalk ? 'Talking…' : 'Hold to talk'}
                </button>
              )}
              {ptt && !phone && vs.pttKey && <span className="text-xs text-muted">or hold {vs.pttKey.label}</span>}
            </div>
          </>
        )}
      </div>
      {menu && menuMember && <VolumeMenu m={menuMember} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  )
}
