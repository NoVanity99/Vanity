import { describe, expect, it } from 'vitest'
import { DEFAULT_VOICE, keyLabel, mouseBinding, normalizeVoice } from '@shared/voiceSettings'
import { backoffMs, dbToUnit, levelDb, qualityOf, SpeechDetector, tuneOpus, unitToDb } from '../detect'

describe('loudness', () => {
  it('measures silence, a quiet tone and a full-scale tone', () => {
    expect(levelDb(new Float32Array(512))).toBe(-100)
    const tone = (amp: number) => Float32Array.from({ length: 480 }, (_, i) => amp * Math.sin((2 * Math.PI * i) / 48))
    expect(levelDb(tone(1))).toBeCloseTo(-3, 0)
    expect(levelDb(tone(0.01))).toBeCloseTo(-43, 0)
    expect(dbToUnit(-50)).toBe(0.5)
    expect(unitToDb(0.25)).toBe(-75)
  })
})

describe('talking detection', () => {
  it('needs a moment above the threshold, then holds on through short pauses', () => {
    const d = new SpeechDetector(-50, 40, 300)
    let t = 0
    const feed = (db: number, ms: number): boolean => {
      let r = false
      for (let i = 0; i < ms / 20; i++) r = d.update(db, (t += 20), 20)
      return r
    }
    expect(feed(-30, 20)).toBe(false) // a single click doesn't count
    expect(feed(-80, 100)).toBe(false)
    expect(feed(-30, 60)).toBe(true) // talking
    expect(feed(-80, 200)).toBe(true) // a short pause between words
    expect(feed(-80, 200)).toBe(false) // stopped
    d.thresholdDb = -20
    expect(feed(-30, 200)).toBe(false) // less sensitive now
  })
})

describe('Opus settings', () => {
  const sdp = ['v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111 63', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1', 'a=rtpmap:63 red/48000/2', ''].join('\r\n')
  it('asks for mono voice with error correction, silence suppression and a bitrate cap', () => {
    const out = tuneOpus(sdp)
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1;stereo=0;sprop-stereo=0;maxaveragebitrate=64000')
    expect(out).toContain('a=rtpmap:63 red/48000/2')
    expect(tuneOpus(out)).toBe(out) // the same twice
  })
  it('adds the line when there is none, and leaves other codecs alone', () => {
    expect(tuneOpus(sdp.replace('a=fmtp:111 minptime=10;useinbandfec=1\r\n', ''))).toMatch(/a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 minptime=10;useinbandfec=1;usedtx=1/)
    expect(tuneOpus('v=0\r\nm=audio 9 RTP 0\r\na=rtpmap:0 PCMU/8000\r\n')).toBe('v=0\r\nm=audio 9 RTP 0\r\na=rtpmap:0 PCMU/8000\r\n')
  })
})

describe('connection quality and reconnecting', () => {
  it('grades round trip and loss', () => {
    expect(qualityOf(null, null)).toBe('unknown')
    expect(qualityOf(40, 0)).toBe('good')
    expect(qualityOf(200, 0)).toBe('ok')
    expect(qualityOf(40, 0.05)).toBe('ok')
    expect(qualityOf(400, 0)).toBe('poor')
    expect(qualityOf(40, 0.2)).toBe('poor')
  })
  it('waits longer after each failed try, up to 15 seconds', () => {
    const mid = () => 0.5
    expect([0, 1, 2, 3, 4, 10].map((n) => backoffMs(n, mid))).toEqual([1000, 2000, 4000, 8000, 15000, 15000])
  })
})

describe('voice settings', () => {
  it('start from sensible defaults and keep only sensible values', () => {
    expect(normalizeVoice(undefined)).toEqual(DEFAULT_VOICE)
    const s = normalizeVoice({ inputMode: 'ptt', sensitivityDb: -500, inputVolume: 9, pttKey: { kind: 'key', code: 'KeyV', label: 'V' }, pttReleaseMs: 'x', noiseSuppression: false, userVolumes: { a: { volume: 1.5, muted: false }, b: { volume: 1, muted: false }, c: { volume: 7, muted: true } } })
    expect(s).toMatchObject({ inputMode: 'ptt', sensitivityDb: -100, inputVolume: 2, pttKey: { kind: 'key', code: 'KeyV', label: 'V' }, pttReleaseMs: 200, noiseSuppression: false })
    expect(s.userVolumes).toEqual({ a: { volume: 1.5, muted: false }, c: { volume: 2, muted: true } })
    expect(normalizeVoice({ pttKey: { kind: 'key', code: '<script>' } }).pttKey).toBeNull()
    expect(normalizeVoice({ pttKey: { kind: 'mouse', button: 4 } }).pttKey).toEqual({ kind: 'mouse', button: 4, label: 'Mouse 4' })
  })
  it('name keys and mouse buttons for people', () => {
    expect(keyLabel('KeyV')).toBe('V')
    expect(keyLabel('AltLeft')).toBe('Left Alt')
    expect(keyLabel('Digit4')).toBe('4')
    expect(keyLabel('F13')).toBe('F13')
    expect(mouseBinding(3)).toEqual({ kind: 'mouse', button: 4, label: 'Mouse 4 (back)' })
    expect(mouseBinding(0)).toBeNull() // left click is never push-to-talk
  })
})
