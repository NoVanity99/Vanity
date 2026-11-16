import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import { IPC, type ScreenAudioStart } from '@shared/ipc'

// Sound for screen sharing (Windows). A small helper (native/audio-capture/vanity-audio.cpp)
// captures it with Windows' per-program audio capture and writes raw PCM (16-bit stereo, 48 kHz),
// which goes to the window as it arrives:
//   - a whole screen: everything you hear EXCEPT Vanity, so the voices of the people in the call
//     (which Vanity plays) are never sent back to them;
//   - one window: only the sound of the program that owns it, like a game.

const BYTES_PER_FRAME = 4

let current: { child: ChildProcess | null; timer: ReturnType<typeof setInterval> | null; to: WebContents } | null = null

function helperPath(): string | null {
  const candidates = [join(process.resourcesPath ?? '', 'app.asar.unpacked', 'resources', 'bin', 'vanity-audio.exe'), join(app.getAppPath(), 'resources', 'bin', 'vanity-audio.exe')]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** For automated tests on machines without Windows audio: a steady tone instead of real capture. */
const fake = (): boolean => process.env.VANITY_FAKE_SCREEN_AUDIO === '1'

export function canShareScreenAudio(): boolean {
  return fake() || (process.platform === 'win32' && helperPath() !== null)
}

export function stopScreenAudio(): void {
  const c = current
  current = null
  if (!c) return
  if (c.timer) clearInterval(c.timer)
  if (c.child && c.child.exitCode === null) {
    // Closing its input stops it cleanly; kill it if it doesn't go.
    c.child.stdin?.end()
    const child = c.child
    setTimeout(() => child.exitCode === null && child.kill(), 1000)
  }
}

/** The arguments for the helper, from a screen-share source id ("screen:…" or "window:<hwnd>:…"). */
export function helperArgs(sourceId: string, selfPid: number): string[] | null {
  if (/^screen:/.test(sourceId)) return ['exclude', String(selfPid)]
  const hwnd = /^window:(\d+):/.exec(sourceId)?.[1]
  return hwnd ? ['window', hwnd, String(selfPid)] : null
}

export async function startScreenAudio(sourceId: string, to: WebContents): Promise<ScreenAudioStart> {
  stopScreenAudio()
  if (fake()) {
    let t = 0
    const timer = setInterval(() => {
      // 10 ms of a 440 Hz tone, stereo.
      const frames = 480
      const buf = Buffer.alloc(frames * BYTES_PER_FRAME)
      for (let i = 0; i < frames; i++, t++) {
        const v = Math.round(Math.sin((2 * Math.PI * 440 * t) / 48000) * 9000)
        buf.writeInt16LE(v, i * 4)
        buf.writeInt16LE(v, i * 4 + 2)
      }
      if (!to.isDestroyed()) to.send(IPC.voiceScreenAudioData, buf)
    }, 10)
    current = { child: null, timer, to }
    return { ok: true }
  }
  const exe = process.platform === 'win32' ? helperPath() : null
  if (!exe) return { ok: false, reason: 'unavailable', message: 'Sharing sound works on Windows only.' }
  const args = helperArgs(sourceId, process.pid)
  if (!args) return { ok: false, reason: 'failed', message: "That screen or window's sound can't be shared." }

  const child = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const mine = { child, timer: null, to }
  current = mine
  let rest: Buffer | null = null
  child.stdout.on('data', (chunk: Buffer) => {
    if (current !== mine || to.isDestroyed()) return
    // Whole frames only (4 bytes each); keep any leftover for the next chunk.
    const data = rest ? Buffer.concat([rest, chunk]) : chunk
    const whole = data.length - (data.length % BYTES_PER_FRAME)
    rest = whole < data.length ? data.subarray(whole) : null
    if (whole > 0) to.send(IPC.voiceScreenAudioData, data.subarray(0, whole))
  })

  return new Promise<ScreenAudioStart>((resolve) => {
    let settled = false
    const done = (r: ScreenAudioStart): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    child.stderr.on('data', (d: Buffer) => {
      if (/ready/.test(d.toString())) done({ ok: true })
    })
    child.on('error', () => done({ ok: false, reason: 'failed', message: "Sound couldn't be shared." }))
    child.on('exit', (code) => {
      const wasRunning = settled
      const wasCurrent = current === mine
      if (wasCurrent) current = null
      if (code === 2) done({ ok: false, reason: 'unsupported', message: 'Sharing sound needs Windows 10 (version 2004 or newer) or Windows 11.' })
      else if (code === 3) done({ ok: false, reason: 'own-window', message: "Vanity's own sound isn't shared, so nobody hears themselves." })
      else done({ ok: false, reason: 'failed', message: "Sound couldn't be shared." })
      // Stopped by itself mid-share (the window closed): tell the window.
      if (wasRunning && wasCurrent && !to.isDestroyed()) to.send(IPC.voiceScreenAudioEnded)
    })
    setTimeout(() => {
      if (settled) return
      done({ ok: false, reason: 'failed', message: "Sound couldn't be shared (Windows didn't answer)." })
      if (current === mine) stopScreenAudio()
    }, 6000)
  })
}
