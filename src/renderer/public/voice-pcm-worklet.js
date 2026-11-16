// Plays the sound of a shared screen (16-bit stereo PCM at 48 kHz, as it arrives from Windows) into
// Web Audio, so it can be sent to the people in a voice room. Loaded by src/renderer/src/voice/audio.ts.
//
// It keeps the delay small: about 20 ms is gathered before playing, and if more than 100 ms
// piles up (a hiccup), the oldest is skipped so the sound never drifts behind the picture.

const SIZE = 48000 // one second of room
const START = 960 // 20 ms
const MAX = 4800 // 100 ms
const KEEP = 1920 // after skipping, keep 40 ms

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super()
    this.left = new Float32Array(SIZE)
    this.right = new Float32Array(SIZE)
    this.read = 0
    this.write = 0
    this.count = 0
    this.playing = false
    this.port.onmessage = (e) => {
      const pcm = new Int16Array(e.data)
      const frames = pcm.length >> 1
      for (let i = 0; i < frames; i++) {
        this.left[this.write] = pcm[2 * i] / 32768
        this.right[this.write] = pcm[2 * i + 1] / 32768
        this.write = (this.write + 1) % SIZE
      }
      this.count = Math.min(SIZE, this.count + frames)
      if (this.count > MAX) {
        const skip = this.count - KEEP
        this.read = (this.read + skip) % SIZE
        this.count = KEEP
      }
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0]
    const left = out[0]
    const right = out[1] || out[0]
    if (!this.playing && this.count < START) {
      left.fill(0)
      right.fill(0)
      return true
    }
    this.playing = true
    for (let i = 0; i < left.length; i++) {
      if (this.count > 0) {
        left[i] = this.left[this.read]
        right[i] = this.right[this.read]
        this.read = (this.read + 1) % SIZE
        this.count--
      } else {
        // Ran dry (nothing is playing on the PC): silence, and gather again before restarting.
        left[i] = 0
        right[i] = 0
        this.playing = false
      }
    }
    return true
  }
}

registerProcessor('vanity-pcm-player', PcmPlayer)
