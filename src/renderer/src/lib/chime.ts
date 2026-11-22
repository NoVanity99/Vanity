// Short sounds made on the spot (no sound files): the "someone started streaming" chime and the
// ring of an incoming call.

let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

/** One soft note. */
function note(c: AudioContext, freq: number, at: number, length: number, volume: number): void {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(volume, at + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(gain).connect(c.destination)
  osc.start(at)
  osc.stop(at + length + 0.05)
}

/** Three rising notes: someone in your call started sharing their screen. `volume` is 0 to 1. */
export function playStreamChime(volume: number): void {
  const c = audio()
  if (!c || volume <= 0) return
  const v = Math.min(1, volume) * 0.35
  const t = c.currentTime + 0.02
  note(c, 659.25, t, 0.22, v)
  note(c, 783.99, t + 0.12, 0.22, v)
  note(c, 1046.5, t + 0.24, 0.4, v)
}

/** Rings until the returned function is called. */
export function startRinging(volume = 0.6): () => void {
  const c = audio()
  if (!c) return () => {}
  const ring = (): void => {
    const t = c.currentTime + 0.02
    for (const start of [0, 0.42]) {
      note(c, 587.33, t + start, 0.3, volume * 0.3)
      note(c, 880, t + start + 0.14, 0.34, volume * 0.3)
    }
  }
  ring()
  const timer = setInterval(ring, 2400)
  return () => clearInterval(timer)
}
