import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { extname, join } from 'node:path'

/**
 * Formats the player can't decode itself, but ffmpeg can: they're converted to FLAC
 * (lossless, so nothing is lost) the first time they play, and the result is cached.
 * Anything else that fails to play is also retried through the converter.
 */
export const CONVERT_EXTS = new Set([
  '.wma',
  '.aiff',
  '.aif',
  '.aifc',
  '.wv',
  '.ape',
  '.caf',
  '.ac3',
  '.eac3',
  '.dts',
  '.mp2',
  '.mpa',
  '.mpc',
  '.tta',
  '.tak',
  '.amr',
  '.w64',
  '.au',
  '.snd',
  '.ra',
  '.rm',
  '.dsf',
  '.alac'
])

export function needsConversion(file: string): boolean {
  return CONVERT_EXTS.has(extname(file).toLowerCase())
}

/** Where Vanity's bundled ffmpeg is, or null on platforms without one. */
export function bundledFfmpeg(): string | null {
  try {
    const { path } = require('@ffmpeg-installer/ffmpeg') as { path: string }
    // Programs can't run from inside the app's .asar archive; electron-builder unpacks it next to it.
    const exe = path.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    return existsSync(exe) ? exe : null
  } catch {
    return null
  }
}

/** Keep at most this many converted songs; the least recently played go first. */
const MAX_CACHED = 400

export class AudioConverter {
  private inFlight = new Map<string, Promise<string>>()

  constructor(
    private ffmpeg: string | null,
    private cacheDir: string
  ) {}

  get available(): boolean {
    return this.ffmpeg !== null
  }

  /** A FLAC copy of `file` that the player can decode (converted once, then cached). */
  async convert(file: string): Promise<string> {
    if (!this.ffmpeg) throw new Error('No audio converter is available on this computer.')
    const { size, mtimeMs } = await fs.stat(file)
    const key = createHash('sha1').update(`${file}\0${size}\0${Math.round(mtimeMs)}`).digest('hex')
    const out = join(this.cacheDir, `${key}.flac`)
    try {
      const now = new Date()
      await fs.utimes(out, now, now) // mark as recently played
      return out
    } catch {
      // Not converted yet.
    }
    let running = this.inFlight.get(key)
    if (!running) {
      running = this.run(file, out).finally(() => this.inFlight.delete(key))
      this.inFlight.set(key, running)
    }
    return running
  }

  private async run(file: string, out: string): Promise<string> {
    await fs.mkdir(this.cacheDir, { recursive: true })
    const part = `${out}.${process.pid}.part`
    await new Promise<void>((resolve, reject) => {
      // First audio stream only, stereo, fastest FLAC compression (it's a local cache).
      const child = spawn(this.ffmpeg!, ['-nostdin', '-v', 'error', '-y', '-i', file, '-map', '0:a:0', '-vn', '-ac', '2', '-c:a', 'flac', '-compression_level', '0', '-f', 'flac', part], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      })
      let err = ''
      child.stderr.on('data', (d) => (err += d))
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited with code ${code}`))))
    }).catch(async (e) => {
      await fs.rm(part, { force: true })
      throw e
    })
    await fs.rename(part, out)
    void this.prune()
    return out
  }

  private async prune(): Promise<void> {
    try {
      const names = (await fs.readdir(this.cacheDir)).filter((n) => n.endsWith('.flac'))
      if (names.length <= MAX_CACHED) return
      const withTimes = await Promise.all(names.map(async (n) => ({ n, t: (await fs.stat(join(this.cacheDir, n))).mtimeMs })))
      withTimes.sort((a, b) => a.t - b.t)
      for (const { n } of withTimes.slice(0, names.length - MAX_CACHED)) await fs.rm(join(this.cacheDir, n), { force: true })
    } catch {
      // Cache housekeeping is best-effort.
    }
  }
}
