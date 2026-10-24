import { createReadStream, promises as fs } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { parseFile } from 'music-metadata'
import type { TrackInfo } from '@shared/types'
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

/** "03 - Artist - Song.mp3" → "Artist - Song", for files without tags. */
export function titleFromFile(file: string): string {
  return basename(file, extname(file)).replace(/^\s*\d{1,3}\s*[-._)]\s*/, '').replace(/_/g, ' ').trim() || basename(file)
}

const COVER_FILES = /^(cover|folder|front|album|albumart(small|large)?|artwork)\.(jpe?g|png|webp)$/i
const IMAGE_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

interface Art {
  data: Uint8Array
  type: string
}

/** Holds the scanned tracks, and reads each one's title, artist and artwork when it plays. */
export class MusicLibrary {
  private tracks: string[] = []
  private folder: string | null = null
  /** Bumped on every rescan, so the UI's track URLs change when the list does. */
  private version = 0
  private info = new Map<number, Promise<{ info: TrackInfo; art: Art | null }>>()

  async load(folder: string | null): Promise<void> {
    this.folder = folder
    this.tracks = folder ? await scanMusic(folder) : []
    this.version++
    this.info.clear()
  }

  state(): { folder: string | null; count: number; version: number } {
    return { folder: this.folder, count: this.tracks.length, version: this.version }
  }

  /** The file for a track number, or null. */
  track(index: number): string | null {
    return Number.isInteger(index) && index >= 0 && index < this.tracks.length ? this.tracks[index] : null
  }

  private read(index: number): Promise<{ info: TrackInfo; art: Art | null }> | null {
    const file = this.track(index)
    if (!file) return null
    let hit = this.info.get(index)
    if (!hit) {
      hit = readTrack(file)
      this.info.set(index, hit)
      // Keep the cache small: artwork can be a few hundred KB per track.
      if (this.info.size > 50) this.info.delete(this.info.keys().next().value!)
    }
    return hit
  }

  /** Title, artist and whether there's artwork, from the file's tags (or its name). */
  async trackInfo(index: number): Promise<TrackInfo | null> {
    return (await this.read(index))?.info ?? null
  }

  /** The track's artwork: embedded in the file, or a cover image next to it. */
  async art(index: number): Promise<Art | null> {
    return (await this.read(index))?.art ?? null
  }
}

async function readTrack(file: string): Promise<{ info: TrackInfo; art: Art | null }> {
  let title: string | null = null
  let artist: string | null = null
  let album: string | null = null
  let art: Art | null = null
  try {
    const meta = await parseFile(file, { duration: false, skipCovers: false })
    title = meta.common.title?.trim() || null
    artist = meta.common.artist?.trim() || meta.common.albumartist?.trim() || null
    album = meta.common.album?.trim() || null
    const pic = meta.common.picture?.[0]
    if (pic?.data?.length) art = { data: pic.data, type: pic.format.includes('/') ? pic.format : `image/${pic.format}` }
  } catch {
    // Unreadable tags: fall back to the file name.
  }
  if (!art) art = await folderCover(dirname(file))
  return { info: { title: title ?? titleFromFile(file), artist, album, hasArt: art !== null }, art }
}

async function folderCover(dir: string): Promise<Art | null> {
  const entries = await safeReaddir(dir)
  const cover = entries.find((e) => e.isFile() && COVER_FILES.test(e.name))
  if (!cover) return null
  try {
    return { data: await fs.readFile(join(dir, cover.name)), type: IMAGE_TYPES[extname(cover.name).toLowerCase()] ?? 'image/jpeg' }
  } catch {
    return null
  }
}
