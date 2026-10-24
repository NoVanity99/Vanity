import { describe, expect, it } from 'vitest'
import { makeTree } from '../../scanners/__tests__/helpers'
import { audioResponse, MusicLibrary, parseRange, scanMusic } from '../library'

describe('music library', () => {
  it('finds audio files recursively and ignores everything else', async () => {
    const root = makeTree({
      'a.mp3': 10,
      'Album/02 track.FLAC': 10,
      'Album/cover.jpg': 10,
      'Album/notes.txt': 'x',
      'Deep/er/song.ogg': 10,
      '.hidden/secret.mp3': 10
    })
    const tracks = await scanMusic(root)
    expect(tracks.map((t) => t.slice(root.length + 1).replace(/\\/g, '/'))).toEqual(['a.mp3', 'Album/02 track.FLAC', 'Deep/er/song.ogg'])
  })

  it('exposes only a count and serves by index', async () => {
    const root = makeTree({ 'x.mp3': 3, 'y.wav': 3 })
    const lib = new MusicLibrary()
    await lib.load(root)
    expect(lib.state()).toMatchObject({ folder: root, count: 2, version: 1 })
    expect(lib.track(1)).toMatch(/y\.wav$/)
    expect(lib.track(2)).toBeNull()
    expect(lib.track(-1)).toBeNull()
    expect(lib.track(0.5)).toBeNull()
    await lib.load(null)
    expect(lib.state()).toMatchObject({ count: 0, version: 2 })
  })

  it('parses Range headers', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 })
    expect(parseRange('bytes=2000-', 1000)).toBeNull()
    expect(parseRange(null, 1000)).toBeNull()
    expect(parseRange('items=1-2', 1000)).toBeNull()
  })

  it('serves whole files and byte ranges', async () => {
    const root = makeTree({ 's.mp3': 'abcdefghij' })
    const full = await audioResponse(`${root}/s.mp3`, null)
    expect(full.status).toBe(200)
    expect(full.headers.get('content-type')).toBe('audio/mpeg')
    expect(await full.text()).toBe('abcdefghij')
    const part = await audioResponse(`${root}/s.mp3`, 'bytes=2-4')
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10')
    expect(await part.text()).toBe('cde')
  })
})
