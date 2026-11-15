import { EventEmitter } from 'node:events'
import { createReadStream, promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import { Readable } from 'node:stream'
import { parseRange } from '../music/library'

/** Web games (an .html file added with "Add a game") open in their own window and are served over this scheme. */
export const GAME_SCHEME = 'vanity-game'
/** Their storage (saves, settings) persists here, separate from Vanity's own. */
export const GAME_PARTITION = 'persist:vanity-games'

export function isHtmlGame(path: string | null | undefined): boolean {
  return !!path && /\.html?$/i.test(path)
}

const GENERIC_PAGES = /^(index|game|main|play|start|default|launcher|app|home)$/i

/** A readable name for a web game: the page's name, or its folder's if the page is called index.html and so on. */
export function nameFromHtml(file: string, prettify: (raw: string) => string): string {
  const base = basename(file).replace(/\.html?$/i, '')
  if (!GENERIC_PAGES.test(base)) return prettify(base)
  const folder = basename(dirname(file))
  return folder ? prettify(folder) : prettify(base)
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.glsl': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
}

/**
 * Serves a file from a web game's folder. Requests can't leave the folder. Supports
 * Range requests (audio/video seeking) and Unity-style precompressed files
 * (game.wasm.br / game.js.gz), and sends the headers some engines need for
 * multithreading (Godot 4, Unity, Emscripten).
 */
export async function gameFileResponse(root: string, urlPath: string, rangeHeader: string | null): Promise<Response> {
  let rel: string
  try {
    rel = decodeURIComponent(urlPath).replace(/^\/+/, '')
  } catch {
    return new Response('Bad path', { status: 400 })
  }
  const file = normalize(join(root, rel || 'index.html'))
  const inside = relative(root, file)
  if (inside.startsWith('..') || isAbsolute(inside) || inside.split(sep).includes('..')) return new Response('Not found', { status: 404 })

  let size: number
  try {
    const st = await fs.stat(file)
    if (!st.isFile()) return new Response('Not found', { status: 404 })
    size = st.size
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const headers: Record<string, string> = {
    'Cache-Control': 'no-cache',
    // Cross-origin isolation, so engines that use threads (SharedArrayBuffer) work.
    // "credentialless" still lets pages load scripts and images from CDNs.
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Accept-Ranges': 'bytes'
  }
  let ext = extname(file).toLowerCase()
  if (ext === '.br' || ext === '.gz') {
    headers['Content-Encoding'] = ext === '.br' ? 'br' : 'gzip'
    ext = extname(file.slice(0, -ext.length)).toLowerCase()
  }
  headers['Content-Type'] = TYPES[ext] ?? 'application/octet-stream'

  // Ranges only for plain files: a range of a compressed file means nothing to the page.
  const range = headers['Content-Encoding'] ? null : parseRange(rangeHeader, size)
  const start = range?.start ?? 0
  const end = range?.end ?? size - 1
  headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1)
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  const body = size === 0 ? null : (Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream)
  return new Response(body, { status: range ? 206 : 200, headers })
}

/** The URL a web game's page opens at: its own origin per game, so each keeps its own saves. */
export function gameUrl(gameId: number, htmlPath: string): string {
  return `${GAME_SCHEME}://game-${gameId}/${encodeURIComponent(basename(htmlPath))}`
}

/** The game ID in a vanity-game:// host, or null. */
export function gameIdFromHost(host: string): number | null {
  const m = /^game-(\d+)$/.exec(host)
  return m ? Number(m[1]) : null
}

/**
 * Something with an 'exit' event, so the playtime tracker can watch a game
 * window exactly like a game's process.
 */
export class GameWindowHandle extends EventEmitter {}
