// The profile looks an account may pick (banner and its effect, picture frame and aura, name
// effect and font, emoji, title). Kept in step
// with src/shared/profileStyle.ts in the app: test/api.test.ts fails if the two lists differ.
// Anything not on these lists is refused, so a profile can never carry arbitrary text or styling.

export interface ProfileStyle {
  banner: string
  frame: string
  nameStyle: string
  flair: string
  nameFont: string
  aura: string
  effect: string
  title: string
}

export const STYLE_OPTIONS = {
  banner: ['default', 'aurora', 'sunset', 'ocean', 'synthwave', 'forest', 'ember', 'galaxy', 'gold', 'candy', 'storm', 'mono', 'lava', 'mint', 'midnight', 'rose', 'toxic', 'arctic', 'royal', 'peach', 'carbon', 'nebula', 'retro', 'blood', 'matrix', 'cotton'],
  frame: ['none', 'accent', 'gold', 'neon', 'ice', 'fire', 'rainbow', 'galaxy', 'silver', 'emerald', 'ruby', 'sapphire', 'sunset', 'toxic', 'void', 'pastel', 'plasma', 'candy'],
  nameStyle: ['plain', 'sunset', 'ocean', 'gold', 'neon', 'ice', 'rainbow', 'fire', 'mint', 'rose', 'silver', 'toxic', 'royal', 'candy', 'aurora', 'lava'],
  flair: ['', '🎮', '🕹️', '🔥', '⭐', '💎', '🚀', '🌙', '⚡', '🎧', '🏆', '🐉', '🍀', '💀', '🌈', '👾', '🎯', '🧩', '🦊', '🐱', '☕', '🎲', '🏹', '⚔️', '🛡️', '🧙', '👻', '🤖', '👽', '🦄', '🐺', '🦉', '🐼', '🐸', '🦖', '🐙', '🌟', '❄️', '🌊', '🌸', '🍕', '🍩', '🎸', '🎨', '📚', '🏎️', '⚽', '🏀', '🧠', '💜', '🖤', '💚', '☠️', '🥷', '🪐', '🌋'],
  nameFont: ['app', 'orbitron', 'audiowide', 'pixel', 'bebas', 'russo', 'rajdhani', 'chakra', 'oxanium', 'kanit', 'playfair', 'quicksand', 'mono'],
  aura: ['none', 'pulse', 'orbit', 'halo', 'sparkle', 'flames', 'glitch', 'rings', 'prism'],
  effect: ['none', 'snow', 'stars', 'embers', 'hearts', 'bubbles', 'rain', 'fireflies', 'scanlines', 'shine'],
  title: ['', 'Casual gamer', 'Night owl', 'Speedrunner', 'Completionist', 'Achievement hunter', 'Co-op buddy', 'Lone wolf', 'Tryhard', 'Chill vibes only', 'Retro fan', 'Collector', 'Explorer', 'Strategist', 'Story lover', 'Indie fan', 'Boss slayer', 'Loot goblin', 'Builder', 'Racer', 'Sharpshooter', 'Healer main', 'Tank main', 'Backseat gamer', 'One more game', 'AFK', 'Touch grass later', 'Professional noob', 'Main character', 'Final boss']
} as const satisfies Record<keyof ProfileStyle, readonly string[]>

export const DEFAULT_STYLE: ProfileStyle = { banner: 'default', frame: 'none', nameStyle: 'plain', flair: '', nameFont: 'app', aura: 'none', effect: 'none', title: '' }

const FIELDS = Object.keys(STYLE_OPTIONS) as (keyof ProfileStyle)[]

/** What is stored (JSON text, or already an object), as a complete style with only known values. */
export function readStyle(stored: unknown): ProfileStyle {
  let v: Record<string, unknown> = {}
  try {
    const parsed: unknown = typeof stored === 'string' ? JSON.parse(stored) : stored
    if (parsed && typeof parsed === 'object') v = parsed as Record<string, unknown>
  } catch {
    // Unreadable: the defaults.
  }
  const out = { ...DEFAULT_STYLE }
  for (const f of FIELDS) if (typeof v[f] === 'string' && (STYLE_OPTIONS[f] as readonly string[]).includes(v[f] as string)) out[f] = v[f] as string
  return out
}

/** Applies the fields that were sent over the current style. Returns null if any of them isn't an allowed value. */
export function mergeStyle(current: ProfileStyle, patch: unknown): ProfileStyle | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null
  const next = { ...current }
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!FIELDS.includes(key as keyof ProfileStyle)) return null
    if (typeof value !== 'string' || !(STYLE_OPTIONS[key as keyof ProfileStyle] as readonly string[]).includes(value)) return null
    next[key as keyof ProfileStyle] = value
  }
  return next
}
