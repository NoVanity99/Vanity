import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MediaCache } from '../mediaCache'
import { fakeFetch, image } from './fakeFetch'

const root = () => mkdtempSync(join(tmpdir(), 'vanity-media-'))

describe('MediaCache', () => {
  it('downloads images to a relative path and serves them back', async () => {
    const { fetch } = fakeFetch([() => image('image/jpeg')])
    const cache = new MediaCache(root(), fetch)
    const rel = await cache.download(7, 'cover', 'https://cdn2.steamgriddb.com/grid/abc.png')
    expect(rel).toMatch(/^games\/7\/cover-[0-9a-f]{10}\.jpg$/)
    expect(existsSync(cache.resolve(rel!)!)).toBe(true)
  })

  it('refuses paths that escape the cache folder', () => {
    const cache = new MediaCache(root(), fakeFetch([]).fetch)
    expect(cache.resolve('../../etc/passwd')).toBeNull()
    expect(cache.resolve('games/../../x')).toBeNull()
    expect(cache.resolve('')).toBeNull()
    expect(cache.resolve('games/1/cover-a.jpg')).not.toBeNull()
  })

  it('returns null for missing images and rejects non-images', async () => {
    const cache = new MediaCache(root(), fakeFetch([(c) => (c.url.endsWith('.html') ? new Response('<html>', { headers: { 'content-type': 'text/html' } }) : undefined)]).fetch)
    expect(await cache.download(1, 'hero', 'https://x/missing.jpg')).toBeNull()
    await expect(cache.download(1, 'hero', 'https://x/page.html')).rejects.toThrow(/Not an image/)
  })

  it('imports files and prunes old versions of a kind', async () => {
    const dir = root()
    const src = join(dir, 'my cover.PNG')
    writeFileSync(src, Buffer.from([1, 2, 3]))
    const cache = new MediaCache(join(dir, 'cache'), fakeFetch([() => image()]).fetch)
    const downloaded = await cache.download(3, 'cover', 'https://x/a.png')
    const imported = await cache.importFile(3, 'cover', src)
    await cache.download(3, 'logo', 'https://x/logo.png')
    await cache.prune(3, 'cover', imported)
    const files = readdirSync(join(dir, 'cache', 'games', '3'))
    expect(files).toContain(imported.split('/').pop())
    expect(files).not.toContain(downloaded!.split('/').pop())
    expect(files.some((f) => f.startsWith('logo-'))).toBe(true)
    await expect(cache.importFile(3, 'cover', join(dir, 'notes.txt'))).rejects.toThrow(/PNG/)
    await cache.removeGame(3)
    expect(existsSync(join(dir, 'cache', 'games', '3'))).toBe(false)
  })
})
