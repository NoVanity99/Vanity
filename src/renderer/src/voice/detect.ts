// Small pure pieces of the voice engine, kept apart so they can be tested without a browser.

/** The loudness of a block of samples, in dB (−100 silence … 0 as loud as it gets). */
export function levelDb(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / Math.max(1, samples.length))
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100
}

/** −100…0 dB as 0…1, for meters and sliders. */
export const dbToUnit = (db: number): number => Math.min(1, Math.max(0, (db + 100) / 100))
export const unitToDb = (unit: number): number => Math.min(0, Math.max(-100, unit * 100 - 100))

/**
 * Decides when someone is talking from their loudness over time. It opens quickly once the
 * level is above the threshold for a moment (so a click or a bump doesn't count), and stays
 * open for a short while after they stop (so the ends of words and short pauses aren't cut).
 */
export class SpeechDetector {
  private above = 0
  private lastLoud = -Infinity
  speaking = false

  constructor(
    public thresholdDb: number,
    /** How long the level must stay above the threshold to count (ms). */
    private attackMs = 40,
    /** How long it stays "talking" after the level drops (ms). */
    private releaseMs = 350
  ) {}

  /** Feed one reading; returns whether they're talking now. */
  update(db: number, now: number, stepMs: number): boolean {
    if (db >= this.thresholdDb) {
      this.above += stepMs
      if (this.above >= this.attackMs) {
        this.speaking = true
        this.lastLoud = now
      }
    } else {
      this.above = 0
      if (this.speaking && now - this.lastLoud > this.releaseMs) this.speaking = false
    }
    return this.speaking
  }

  reset(): void {
    this.above = 0
    this.lastLoud = -Infinity
    this.speaking = false
  }
}

/**
 * Tunes the Opus audio codec in a connection description (SDP) for voice: one channel,
 * forward error correction (so a lost packet is rebuilt from the next), discontinuous
 * transmission (almost nothing is sent during silence), and up to 64 kbit/s.
 */
export function tuneOpus(sdp: string): string {
  const pt = /^a=rtpmap:(\d+) opus\/48000\/2/im.exec(sdp)?.[1]
  if (!pt) return sdp
  const wanted: Record<string, string> = { minptime: '10', useinbandfec: '1', usedtx: '1', stereo: '0', 'sprop-stereo': '0', maxaveragebitrate: '64000' }
  const fmtp = new RegExp(`^a=fmtp:${pt} (.*)$`, 'im')
  const existing = fmtp.exec(sdp)
  if (existing) {
    const params = new Map(
      existing[1]
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const [k, ...v] = p.split('=')
          return [k.trim(), v.join('=').trim()] as [string, string]
        })
    )
    for (const [k, v] of Object.entries(wanted)) params.set(k, v)
    return sdp.replace(fmtp, `a=fmtp:${pt} ${[...params].map(([k, v]) => `${k}=${v}`).join(';')}`)
  }
  // No fmtp line yet: add one right after the rtpmap.
  const line = `a=fmtp:${pt} ${Object.entries(wanted)
    .map(([k, v]) => `${k}=${v}`)
    .join(';')}`
  return sdp.replace(new RegExp(`(^a=rtpmap:${pt} opus/48000/2\\r?\\n)`, 'im'), `$1${line}\r\n`)
}

export type Quality = 'good' | 'ok' | 'poor' | 'unknown'

/** Connection quality from the round trip (ms) and the share of audio packets lost (0–1). */
export function qualityOf(rttMs: number | null, loss: number | null): Quality {
  if (rttMs === null && loss === null) return 'unknown'
  const r = rttMs ?? 0
  const l = loss ?? 0
  if (r > 300 || l > 0.08) return 'poor'
  if (r > 150 || l > 0.03) return 'ok'
  return 'good'
}

/** Waits this long before reconnecting attempt `n` (1, 2, 4, 8 … seconds, at most 15, with a little randomness). */
export function backoffMs(n: number, random = Math.random): number {
  const base = Math.min(15_000, 1000 * 2 ** Math.max(0, n))
  return Math.round(base * (0.8 + random() * 0.4))
}

/** A random id for this visit to a room (resent after a dropped connection to get the same place back). */
export function newSessionId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return 'v' + [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20)
}
