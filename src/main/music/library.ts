import { createReadStream, promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { safeReaddir } from '../util/fs'

export const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm'
}

const MAX_TRACKS = 20_000
const MAX_DEPTH = 8

/** Every playable audio file under `folder` (recursive), in a stable order. */
export async function scanMusic(folder: string): Promise<string[]> {
  const found: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (found.length >= MAX_TRACKS || depth > MAX_DEPTH) return
    for (const e of await safeReaddir(dir)) {
      if (found.length >= MAX_TRACKS) return
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full, depth + 1)
      else if (e.isFile() && AUDIO_TYPES[extname(e.name).toLowerCase()]) found.push(full)
    }
  }
  await walk(folder, 0)
  return found.sort((a, b) => a.localeCompare(b))
}

/** Parses an HTTP Range header ("bytes=100-", "bytes=0-499", "bytes=-500") against a file size. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null
  if (!m || (m[1] === '' && m[2] === '')) return null
  let start: number
  let end: number
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  return start <= end && start < size ? { start, end } : null
}

/** Serves an audio file as a (possibly partial) Response, so <audio> can stream and seek. */
export async function audioResponse(file: string, rangeHeader: string | null): Promise<Response> {
  const { size } = await fs.stat(file)
  const type = AUDIO_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
  const range = parseRange(rangeHeader, size)
  const start = range?.start ?? 0
  const end = range?.end ?? size - 1
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  return new Response(body, { status: range ? 206 : 200, headers })
}

/** Holds the scanned tracks. The UI only ever sees how many there are, never names or paths. */
export class MusicLibrary {
  private tracks: string[] = []
  private folder: string | null = null
  /** Bumped on every rescan, so the UI's track URLs change when the list does. */
  private version = 0

  async load(folder: string | null): Promise<void> {
    this.folder = folder
    this.tracks = folder ? await scanMusic(folder) : []
    this.version++
  }

  state(): { folder: string | null; count: number; version: number } {
    return { folder: this.folder, count: this.tracks.length, version: this.version }
  }

  /** The file for a track number, or null. */
  track(index: number): string | null {
    return Number.isInteger(index) && index >= 0 && index < this.tracks.length ? this.tracks[index] : null
  }
}
