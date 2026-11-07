import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AudioConverter, needsConversion } from '../convert'
import { scanMusic } from '../library'

// The ffmpeg that ships with Vanity (from @ffmpeg-installer) for this platform, if npm installed one.
const FFMPEG = join(__dirname, '../../../../node_modules/@ffmpeg-installer', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const hasFfmpeg = existsSync(FFMPEG)

describe('audio conversion', () => {
  it('knows which formats need converting', () => {
    expect(['a.wma', 'b.AIFF', 'c.wv', 'd.ape', 'e.dts'].every(needsConversion)).toBe(true)
    expect(['a.mp3', 'b.flac', 'c.m4a', 'd.ogg', 'e.wav'].some(needsConversion)).toBe(false)
  })

  it('finds convertible files only when they can be converted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vanity-scan-'))
    for (const f of ['a.mp3', 'b.wma', 'c.aiff', 'd.mka', 'e.txt']) writeFileSync(join(dir, f), 'x')
    const names = async (convertible: boolean) => (await scanMusic(dir, convertible)).map((p) => p.slice(dir.length + 1))
    expect(await names(false)).toEqual(['a.mp3', 'd.mka'])
    expect(await names(true)).toEqual(['a.mp3', 'b.wma', 'c.aiff', 'd.mka'])
  })

  it.runIf(hasFfmpeg)(
    'converts WMA and Apple Lossless to cached FLAC',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'vanity-conv-'))
      const make = (name: string, ...codec: string[]): string => {
        execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...codec, join(dir, name)])
        return join(dir, name)
      }
      const wma = make('song.wma', '-c:a', 'wmav2')
      const alac = make('song.m4a', '-c:a', 'alac')
      const c = new AudioConverter(FFMPEG, join(dir, 'cache'))
      expect(c.available).toBe(true)

      const [a, b] = await Promise.all([c.convert(wma), c.convert(wma)]) // concurrent requests share one conversion
      expect(a).toBe(b)
      expect(a.endsWith('.flac')).toBe(true)
      expect(statSync(a).size).toBeGreaterThan(1000)
      const flac = await c.convert(alac)
      expect(flac).not.toBe(a)
      expect(await c.convert(alac)).toBe(flac) // cached
      expect(readdirSync(join(dir, 'cache')).filter((n) => n.endsWith('.part'))).toEqual([])

      writeFileSync(join(dir, 'broken.wma'), 'not audio')
      await expect(c.convert(join(dir, 'broken.wma'))).rejects.toThrow()
      expect(readdirSync(join(dir, 'cache')).filter((n) => n.endsWith('.part'))).toEqual([])
    },
    30_000
  )

  it('says so when no converter is available', async () => {
    const c = new AudioConverter(null, tmpdir())
    expect(c.available).toBe(false)
    await expect(c.convert('x.wma')).rejects.toThrow(/No audio converter/)
  })
})
