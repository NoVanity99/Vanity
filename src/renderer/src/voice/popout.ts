import { voice } from '@/state/voice'
import type { VoiceSnapshot } from './client'

// A friend's shared screen in a window of its own: move it to another monitor, make it full
// screen, keep it on top, and keep watching while you use the rest of Vanity. The window is a
// blank page opened from here (the main process only allows "vanity-stream-…" ones); the live
// picture is put straight into it, so nothing is loaded or sent anywhere new.
//
// Its sound keeps playing through Vanity (with your stream volume) for as long as it's open.

interface PopOut {
  win: Window
  video: HTMLVideoElement
  name: string
  stream: MediaStream
  /** "… stopped sharing", shown over the picture. */
  ended: HTMLDivElement
}

const open = new Map<string, PopOut>()
const listeners = new Set<() => void>()
const changed = (): void => listeners.forEach((l) => l())

/** Peer ids whose stream is popped out right now. */
export function poppedOut(): Set<string> {
  return new Set(open.keys())
}

export function onPopOutsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const windowName = (peerId: string): string => `vanity-stream-${peerId.replace(/[^\w-]/g, '_').slice(0, 60)}`

export function popOut(peerId: string, name: string, stream: MediaStream): void {
  const existing = open.get(peerId)
  if (existing && !existing.win.closed) {
    existing.win.focus()
    return
  }
  const win = window.open('', windowName(peerId), 'width=1280,height=760')
  if (!win) return
  // The new window loads its blank page a moment later, which would wipe anything put in it
  // now: fill it once that's done.
  let tries = 0
  const whenReady = (): void => {
    if (win.closed) return
    if (win.document.readyState === 'complete' && win.document.body && tries >= 2) return fill(win, peerId, name, stream)
    tries++
    setTimeout(whenReady, 50)
  }
  whenReady()
}

function fill(win: Window, peerId: string, name: string, stream: MediaStream): void {
  const doc = win.document
  doc.title = `${name}'s screen · Vanity`
  doc.body.innerHTML = ''
  doc.documentElement.style.cssText = 'height:100%;background:#000'
  doc.body.style.cssText = 'margin:0;height:100%;background:#000;overflow:hidden;font:13px "Segoe UI",system-ui,sans-serif;color:#fff;user-select:none'

  const video = doc.createElement('video')
  video.autoplay = true
  video.muted = true
  video.playsInline = true
  video.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;background:#000'
  video.srcObject = stream
  void video.play().catch(() => {})
  doc.body.appendChild(video)

  // A small bar along the top that shows while the mouse moves.
  const bar = doc.createElement('div')
  bar.style.cssText = 'position:fixed;inset:0 0 auto 0;display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(#000c,#0000);transition:opacity .25s;opacity:1'
  const live = doc.createElement('span')
  live.textContent = 'LIVE'
  live.style.cssText = 'background:#ff4757;border-radius:5px;padding:2px 6px;font-weight:800;font-size:10px;letter-spacing:.08em'
  const title = doc.createElement('span')
  title.textContent = `${name}'s screen`
  title.style.cssText = 'font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = doc.createElement('button')
    b.textContent = label
    b.style.cssText = 'background:#ffffff1f;color:#fff;border:0;border-radius:8px;padding:6px 10px;font:inherit;font-weight:600;cursor:pointer'
    b.onmouseenter = () => (b.style.background = '#ffffff38')
    b.onmouseleave = () => (b.style.background = '#ffffff1f')
    b.onclick = onClick
    return b
  }
  let onTop = false
  const pin = button('Keep on top', () => {
    onTop = !onTop
    pin.textContent = onTop ? 'On top ✓' : 'Keep on top'
    void window.vanity.voice.setPopOutOnTop(windowName(peerId), onTop)
  })
  const toggleFull = (): void => {
    if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => {})
    else void doc.documentElement.requestFullscreen().catch(() => {})
  }
  const full = button('Full screen', toggleFull)
  doc.addEventListener('fullscreenchange', () => (full.textContent = doc.fullscreenElement ? 'Exit full screen' : 'Full screen'))
  bar.append(live, title, pin, full)
  doc.body.appendChild(bar)

  const ended = doc.createElement('div')
  ended.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;font-size:16px;color:#ccc;background:#000'
  ended.textContent = `${name} stopped sharing.`
  doc.body.appendChild(ended)

  let hide: ReturnType<typeof setTimeout> | null = null
  const wake = (): void => {
    bar.style.opacity = '1'
    doc.body.style.cursor = 'default'
    if (hide) clearTimeout(hide)
    hide = setTimeout(() => {
      bar.style.opacity = '0'
      doc.body.style.cursor = 'none'
    }, 2500)
  }
  doc.addEventListener('mousemove', wake)
  video.addEventListener('dblclick', toggleFull)
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F11') {
      e.preventDefault()
      toggleFull()
    }
    if (e.key === 'Escape' && doc.fullscreenElement) void doc.exitFullscreen().catch(() => {})
  })
  wake()

  const entry: PopOut = { win, video, name, stream, ended }
  open.set(peerId, entry)
  win.addEventListener('pagehide', () => {
    if (open.get(peerId) !== entry) return
    open.delete(peerId)
    // Closing the window stops the sound too, unless the stream is also shown on the voice page.
    if (voice.snapshot.watching === peerId && !document.querySelector('[data-screen-stage]')) voice.watch(null)
    changed()
  })
  // Watching it: its sound plays.
  voice.watch(peerId)
  changed()
}

export function closePopOut(peerId: string): void {
  const p = open.get(peerId)
  if (!p) return
  open.delete(peerId)
  if (!p.win.closed) p.win.close()
  changed()
}

/** Keeps pop-outs in step with the call: a new picture after a reconnect, "stopped sharing", leaving. */
function sync(s: VoiceSnapshot): void {
  for (const [id, p] of open) {
    if (p.win.closed) {
      open.delete(id)
      changed()
      continue
    }
    if (s.status === 'idle' || s.status === 'error') {
      closePopOut(id)
      continue
    }
    const member = s.members.find((m) => m.id === id)
    p.ended.style.display = member?.sharing ? 'none' : 'flex'
    const stream = s.videos[id]
    if (stream && stream !== p.stream) {
      p.stream = stream
      p.video.srcObject = stream
      void p.video.play().catch(() => {})
    }
    // Keep its sound on while it's popped out, even if the voice page let go of it.
    if (member?.sharing && s.watching !== id && !s.watching) voice.watch(id)
  }
}
voice.subscribe(sync)
