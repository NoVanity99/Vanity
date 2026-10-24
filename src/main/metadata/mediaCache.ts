import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ArtworkKind } from '@shared/types'
import { HttpError, request, type FetchFn } from './http'

const MAX_BYTES = 25 * 1024 * 1024

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico'
}
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'ico', 'bmp'])

/**
 * Stores downloaded and imported artwork under one folder. The database keeps
 * paths relative to it ("games/12/cover-1a2b3c4d5e.jpg"), with forward slashes.
 */
export class MediaCache {
  constructor(
    readonly root: string,
    private fetchFn: FetchFn
  ) {}

  /** Absolute path for a stored relative path, or null if it would escape the cache folder. */
  resolve(relPath: string): string | null {
    const abs = resolve(this.root, ...relPath.split('/'))
    const rel = relative(this.root, abs)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
    return abs
  }

  private relFor(gameId: number, kind: ArtworkKind, key: string, ext: string): string {
    const hash = createHash('sha1').update(key).digest('hex').slice(0, 10)
    return `games/${gameId}/${kind}-${hash}.${ext}`
  }

  private async write(rel: string, data: Buffer): Promise<void> {
    const abs = this.resolve(rel)!
    await fs.mkdir(join(abs, '..'), { recursive: true })
    await fs.writeFile(`${abs}.tmp`, data)
    await fs.rename(`${abs}.tmp`, abs)
  }

  /** Downloads an image URL. Returns null if there is no such image (404). */
  async download(gameId: number, kind: ArtworkKind, url: string): Promise<string | null> {
    let res: Response
    try {
      res = await request(this.fetchFn, url, {}, 'Image download')
    } catch (err) {
      if (err instanceof HttpError && (err.status === 404 || err.status === 403)) return null
      throw err
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const fromUrl = extname(new URL(url).pathname).slice(1).toLowerCase()
    const ext = EXT_BY_TYPE[type] ?? (IMAGE_EXTS.has(fromUrl) ? fromUrl : null)
    if (!ext) throw new Error(`Not an image (${type || 'unknown type'}): ${url}`)
    const data = Buffer.from(await res.arrayBuffer())
    if (data.length === 0) return null
    if (data.length > MAX_BYTES) throw new Error(`Image too large: ${url}`)
    const rel = this.relFor(gameId, kind, url, ext)
    await this.write(rel, data)
    return rel
  }

  /** Copies an image file the user picked into the cache. */
  async importFile(gameId: number, kind: ArtworkKind, file: string): Promise<string> {
    const ext = extname(file).slice(1).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) throw new Error('Choose a PNG, JPG, WebP, GIF, AVIF, ICO or BMP image.')
    const data = await fs.readFile(file)
    if (data.length > MAX_BYTES) throw new Error('That image is larger than 25 MB.')
    const rel = this.relFor(gameId, kind, `${file}:${data.length}:${Date.now()}`, ext === 'jpeg' ? 'jpg' : ext)
    await this.write(rel, data)
    return rel
  }

  /** Deletes a game's files of one kind, except `keep`. */
  async prune(gameId: number, kind: ArtworkKind, keep: string | null): Promise<void> {
    const dir = this.resolve(`games/${gameId}`)
    if (!dir) return
    let names: string[] = []
    try {
      names = await fs.readdir(dir)
    } catch {
      return
    }
    const keepName = keep?.split('/').pop()
    await Promise.all(
      names
        .filter((n) => n.startsWith(`${kind}-`) && n !== keepName)
        .map((n) => fs.rm(join(dir, n), { force: true }).catch(() => {}))
    )
  }

  async removeGame(gameId: number): Promise<void> {
    const dir = this.resolve(`games/${gameId}`)
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  /** Size of the cache in bytes. */
  async size(): Promise<number> {
    let total = 0
    const walk = async (dir: string): Promise<void> => {
      for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = join(dir, e.name)
        if (e.isDirectory()) await walk(p)
        else total += (await fs.stat(p).catch(() => ({ size: 0 }))).size
      }
    }
    await walk(this.root)
    return total
  }
}

