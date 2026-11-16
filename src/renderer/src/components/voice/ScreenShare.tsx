import { useEffect, useRef, useState } from 'react'
import { AppWindow, ExternalLink, Loader2, Maximize2, Minimize2, Monitor, Radio, RefreshCw, Volume2, VolumeX, X } from 'lucide-react'
import type { ScreenSource } from '@shared/ipc'
import { Button, Dialog } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import { loadPref, savePref } from '@/lib/storage'
import { useVoice, voice } from '@/state/voice'
import { popOut } from '@/voice/popout'
import { SHARE_QUALITY, type ShareQuality } from '@/voice/client'

/** A live picture (a shared screen). */
export function StreamVideo({ stream, className, contain = true }: { stream: MediaStream; className?: string; contain?: boolean }): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || el.srcObject === stream) return
    el.srcObject = stream
    void el.play().catch(() => {})
  }, [stream])
  return <video ref={ref} autoPlay muted playsInline className={cn('bg-black', contain ? 'object-contain' : 'object-cover', className)} />
}

/** Pick a screen or window to share, and how sharp and smooth it should be. */
export function ScreenPicker({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [sources, setSources] = useState<ScreenSource[] | null>(null)
  const [tab, setTab] = useState<'screen' | 'window'>('screen')
  const [picked, setPicked] = useState<ScreenSource | null>(null)
  const [quality, setQuality] = useState<ShareQuality>(() => {
    const q = loadPref<string>('share-quality', 'sharp')
    return q in SHARE_QUALITY ? (q as ShareQuality) : 'sharp'
  })
  const [starting, setStarting] = useState(false)
  const [canSound, setCanSound] = useState(false)
  const [sound, setSound] = useState(() => loadPref<boolean>('share-sound', true))
  useEffect(() => {
    void window.vanity.voice.canShareScreenAudio().then(setCanSound, () => setCanSound(false))
  }, [])

  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    []
  )
  // The system sometimes lists no screens for a few seconds (often just after a share ends): keep
  // looking for a while before saying none were found.
  const load = async (): Promise<void> => {
    setSources(null)
    const until = Date.now() + 20_000
    let list: ScreenSource[] = []
    while (alive.current) {
      list = await window.vanity.voice.screenSources().catch(() => [])
      if (list.some((s) => s.kind === 'screen') || Date.now() > until) break
      await new Promise((r) => setTimeout(r, 1000))
    }
    if (alive.current) setSources(list)
  }
  useEffect(() => {
    void load()
  }, [])

  const shown = (sources ?? []).filter((s) => s.kind === tab)
  const go = async (): Promise<void> => {
    if (!picked) return
    setStarting(true)
    savePref('share-quality', quality)
    savePref('share-sound', sound)
    await voice.startScreenShare(picked, quality, canSound && sound)
    setStarting(false)
    onClose()
  }

  return (
    <Dialog
      size="2xl"
      title="Share your screen"
      description="Everyone in the room can watch. Only the screen or window you pick is shared."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void go()} disabled={!picked || starting} data-go-live>
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" />} Go live
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <div className="flex rounded-xl bg-white/5 p-1 text-sm">
          {(['screen', 'window'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn('flex items-center gap-2 rounded-lg px-3 py-1.5 transition', tab === t ? 'bg-white/15 font-semibold' : 'text-muted hover:text-text')}
              data-share-tab={t}
            >
              {t === 'screen' ? <Monitor className="size-4" /> : <AppWindow className="size-4" />} {t === 'screen' ? 'Screens' : 'Windows'}
            </button>
          ))}
        </div>
        <button onClick={() => void load()} disabled={sources === null} className="ml-auto rounded-lg p-2 text-muted transition hover:bg-white/10 hover:text-text" aria-label="Refresh the list" title="Refresh the list">
          <RefreshCw className="size-4" />
        </button>
      </div>

      <div className="mt-4 grid max-h-[42vh] grid-cols-2 gap-3 overflow-y-auto pr-1 [scrollbar-width:thin] md:grid-cols-3" data-share-sources>
        {sources === null ? (
          <p className="col-span-full flex items-center justify-center gap-2 py-12 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Looking for screens and windows…
          </p>
        ) : shown.length === 0 ? (
          <p className="col-span-full py-12 text-center text-sm text-muted">{tab === 'screen' ? 'No screens were found.' : 'No windows are open.'}</p>
        ) : (
          shown.map((s) => (
            <button
              key={s.id}
              onClick={() => setPicked(s)}
              onDoubleClick={() => {
                setPicked(s)
                void go()
              }}
              className={cn('group rounded-2xl border-2 p-1.5 text-left transition', picked?.id === s.id ? 'border-accent bg-accent/10' : 'border-transparent bg-white/5 hover:bg-white/10')}
              data-share-source={s.name}
            >
              <span className="block aspect-video overflow-hidden rounded-xl bg-black">
                {s.thumbnail ? <img src={s.thumbnail} alt="" className="size-full object-contain" /> : <Monitor className="m-auto size-8 h-full text-muted" />}
              </span>
              <span className="mt-1.5 flex items-center gap-2 px-1 text-xs">
                {s.icon && <img src={s.icon} alt="" className="size-4 shrink-0" />}
                <span className="truncate">{s.name}</span>
              </span>
            </button>
          ))
        )}
      </div>

      <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-muted">Quality</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {(Object.keys(SHARE_QUALITY) as ShareQuality[]).map((q) => (
          <button
            key={q}
            onClick={() => setQuality(q)}
            className={cn('rounded-xl border px-3 py-2 text-left transition', quality === q ? 'border-accent bg-accent/10' : 'border-border hover:border-white/20')}
            data-share-quality={q}
          >
            <span className="block text-sm font-semibold">{SHARE_QUALITY[q].label}</span>
            <span className="block text-xs text-muted">{SHARE_QUALITY[q].hint}</span>
          </button>
        ))}
      </div>
      {canSound ? (
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border px-3 py-2.5 transition hover:border-white/20" data-share-sound>
          <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Share sound</span>
            <span className="block text-xs text-muted">
              {tab === 'window' ? "Only that window's program is heard (a game, a video)." : 'Everything you hear except Vanity, so nobody in the call hears themselves back.'}
            </span>
          </span>
        </label>
      ) : (
        <p className="mt-3 text-xs text-muted">Sharing sound works in Vanity for Windows.</p>
      )}
      <p className="mt-3 text-xs text-muted">Higher quality uses more upload for each person watching.</p>
    </Dialog>
  )
}

/** The big picture of someone's shared screen, with full screen and close. */
export function ScreenStage({ stream, name, you, peerId, onClose }: { stream: MediaStream; name: string; you: boolean; peerId?: string; onClose: () => void }): React.JSX.Element {
  const v = useVoice()
  const [canPop, setCanPop] = useState(false)
  // Whether sound is coming through (a little meter next to the volume).
  const [level, setLevel] = useState(-100)
  useEffect(() => {
    if (you || !peerId) return
    const t = setInterval(() => setLevel(voice.streamLevelDb(peerId)), 150)
    return () => clearInterval(t)
  }, [you, peerId])
  useEffect(() => {
    void window.vanity.voice.canPopOut().then(setCanPop, () => setCanPop(false))
  }, [])
  const box = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  useEffect(() => {
    const on = (): void => setFull(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFull = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void box.current?.requestFullscreen().catch(() => {})
  }
  return (
    <section ref={box} className="animate-pop-in group relative overflow-hidden rounded-3xl border border-border bg-black" data-screen-stage={name}>
      <StreamVideo stream={stream} className={cn('w-full', full ? 'h-screen' : 'aspect-video max-h-[62vh]')} />
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-4 py-3 opacity-100 transition group-hover:opacity-100 md:opacity-0">
        <span className="flex items-center gap-1.5 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
          <Radio className="size-3" /> Live
        </span>
        <span className="truncate text-sm font-semibold text-white">{you ? 'Your screen' : `${name}'s screen`}</span>
        <span className="ml-auto flex items-center gap-1">
          {!you && (
            <span className="mr-1 flex items-center gap-1.5" title="Stream sound (only for you)">
              <button onClick={() => voice.setStreamVolume(v.streamVolume > 0 ? 0 : 1)} className="rounded-lg p-2 text-white/80 transition hover:bg-white/15 hover:text-white" aria-label={v.streamVolume > 0 ? 'Mute stream sound' : 'Unmute stream sound'} data-stream-mute>
                {v.streamVolume > 0 ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </button>
              <span className="flex h-3 items-end gap-[2px]" aria-hidden data-stream-level={level > -60 ? 'sound' : 'quiet'}>
                {[-55, -40, -25].map((t) => (
                  <span key={t} className={cn('w-[3px] rounded-sm transition-colors', level > t ? 'bg-emerald-400' : 'bg-white/25')} style={{ height: `${t === -55 ? 4 : t === -40 ? 8 : 12}px` }} />
                ))}
              </span>
              <input type="range" min={0} max={200} step={5} value={Math.round(v.streamVolume * 100)} onChange={(e) => voice.setStreamVolume(Number(e.target.value) / 100)} aria-label="Stream volume" className="w-24 accent-[var(--color-accent)]" data-stream-volume />
            </span>
          )}
          {!you && canPop && peerId && (
            <button
              onClick={() => popOut(peerId, name, stream)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/15 hover:text-white"
              title="Open in its own window: move it anywhere, even another monitor, and keep watching while you use Vanity"
              data-pop-out
            >
              <ExternalLink className="size-4" /> Pop out
            </button>
          )}
          <button onClick={toggleFull} className="rounded-lg p-2 text-white/80 transition hover:bg-white/15 hover:text-white" aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen' : 'Full screen'}>
            {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
          <button onClick={onClose} className="rounded-lg p-2 text-white/80 transition hover:bg-white/15 hover:text-white" aria-label={you ? 'Hide the preview' : 'Stop watching'} title={you ? 'Hide the preview' : 'Stop watching'}>
            <X className="size-4" />
          </button>
        </span>
      </div>
    </section>
  )
}
