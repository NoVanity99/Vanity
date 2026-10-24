import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MusicLibrary, titleFromFile } from '../library'

/** A minimal MP3: an ID3v2.3 tag (title, artist, cover) followed by a few silent MPEG frames. */
function mp3(title: string, artist: string, cover?: Buffer): Buffer {
  const frame = (id: string, body: Buffer): Buffer => {
    const h = Buffer.alloc(10)
    h.write(id, 0, 'latin1')
    h.writeUInt32BE(body.length, 4)
    return Buffer.concat([h, body])
  }
  const text = (s: string): Buffer => Buffer.concat([Buffer.from([0]), Buffer.from(s, 'latin1')])
  const frames = [frame('TIT2', text(title)), frame('TPE1', text(artist))]
  if (cover) frames.push(frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0', 'latin1'), Buffer.from([3]), Buffer.from('\0', 'latin1'), cover])))
  const body = Buffer.concat(frames)
  const size = Buffer.alloc(4)
  for (let i = 0; i < 4; i++) size[3 - i] = (body.length >> (7 * i)) & 0x7f
  const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0]), size])
  // MPEG-1 Layer III, 128 kbps, 44.1 kHz frames (417 bytes each).
  const mpeg = Buffer.alloc(417 * 4)
  for (let i = 0; i < 4; i++) mpeg.set([0xff, 0xfb, 0x90, 0x00], i * 417)
  return Buffer.concat([header, body, mpeg])
}

describe('track info', () => {
  it('reads tags and embedded artwork, and falls back to the file name and folder cover', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vanity-music-'))
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    writeFileSync(join(dir, 'a.mp3'), mp3('Midnight City', 'M83', png))
    const sub = join(dir, 'Album')
    mkdirSync(sub)
    writeFileSync(join(sub, '07 - Untagged Song.mp3'), Buffer.alloc(2000))
    writeFileSync(join(sub, 'Cover.JPG'), Buffer.from('jpegdata'))

    const lib = new MusicLibrary()
    await lib.load(dir)
    expect(lib.state().count).toBe(2)
    const tagged = await lib.trackInfo(0) // "a.mp3" sorts before "Album/…"
    expect(tagged).toEqual({ title: 'Midnight City', artist: 'M83', album: null, hasArt: true })
    expect((await lib.art(0))?.type).toBe('image/png')

    expect(await lib.trackInfo(1)).toEqual({ title: 'Untagged Song', artist: null, album: null, hasArt: true })
    expect((await lib.art(1))?.type).toBe('image/jpeg')
    expect(await lib.trackInfo(5)).toBeNull()
  })

  it('cleans up file names', () => {
    expect(titleFromFile('C:\\\\Music\\\\01. Intro.flac'.replace(/\\\\/g, '/'))).toBe('Intro')
    expect(titleFromFile('/m/my_song_name.mp3')).toBe('my song name')
  })
})
