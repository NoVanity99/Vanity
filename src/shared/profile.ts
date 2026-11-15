/**
 * How your profile looks to you and to your friends: a banner, a frame around your picture,
 * a style for your name, a moving effect, a flair emoji and a short tagline. Everything is an ID
 * from the lists below (drawn with CSS by the app), so nothing but these few words is ever sent.
 */
export interface ProfileStyle {
  banner: string
  frame: string
  nameStyle: string
  effect: string
  /** One emoji shown beside your name; empty for none. */
  flair: string
  /** A line under your name, up to 60 characters. */
  tagline: string
}

export interface ProfileOption {
  id: string
  name: string
}

export const BANNERS: ProfileOption[] = [
  { id: 'theme', name: 'Your theme' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'ocean', name: 'Deep ocean' },
  { id: 'galaxy', name: 'Galaxy' },
  { id: 'ember', name: 'Ember' },
  { id: 'toxic', name: 'Toxic' },
  { id: 'cyber', name: 'Cyber grid' },
  { id: 'candy', name: 'Candy' },
  { id: 'gold', name: 'Gold' },
  { id: 'mono', name: 'Monochrome' },
  { id: 'rainbow', name: 'Rainbow flow' }
]

export const FRAMES: ProfileOption[] = [
  { id: 'none', name: 'None' },
  { id: 'accent', name: 'Accent ring' },
  { id: 'glow', name: 'Neon glow' },
  { id: 'gold', name: 'Gold' },
  { id: 'rainbow', name: 'Spinning rainbow' },
  { id: 'pulse', name: 'Pulse' },
  { id: 'fire', name: 'Fire' },
  { id: 'ice', name: 'Ice' }
]

export const NAME_STYLES: ProfileOption[] = [
  { id: 'plain', name: 'Plain' },
  { id: 'accent', name: 'Accent' },
  { id: 'gradient', name: 'Gradient' },
  { id: 'gold', name: 'Gold shine' },
  { id: 'rainbow', name: 'Rainbow' },
  { id: 'glow', name: 'Glow' },
  { id: 'glitch', name: 'Glitch' }
]

export const EFFECTS: ProfileOption[] = [
  { id: 'none', name: 'None' },
  { id: 'shimmer', name: 'Shimmer' },
  { id: 'sparkle', name: 'Sparkles' },
  { id: 'stars', name: 'Starfield' },
  { id: 'scanlines', name: 'Scanlines' },
  { id: 'bubbles', name: 'Bubbles' }
]

export const FLAIRS = ['', '🎮', '🔥', '👑', '⚡', '💎', '🌙', '🚀', '🎯', '🐉', '👾', '🌈', '☠️', '🍀', '🎧', '🏆', '❤️', '🧊']

export const DEFAULT_PROFILE: ProfileStyle = { banner: 'theme', frame: 'accent', nameStyle: 'plain', effect: 'none', flair: '', tagline: '' }

const pick = (list: ProfileOption[], value: unknown, fallback: string): string =>
  typeof value === 'string' && list.some((o) => o.id === value) ? value : fallback

/** Turns anything (stored settings, a server answer) into a valid profile style. */
export function sanitizeProfile(raw: unknown): ProfileStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    banner: pick(BANNERS, r.banner, DEFAULT_PROFILE.banner),
    frame: pick(FRAMES, r.frame, DEFAULT_PROFILE.frame),
    nameStyle: pick(NAME_STYLES, r.nameStyle, DEFAULT_PROFILE.nameStyle),
    effect: pick(EFFECTS, r.effect, DEFAULT_PROFILE.effect),
    flair: typeof r.flair === 'string' && FLAIRS.includes(r.flair) ? r.flair : '',
    tagline: typeof r.tagline === 'string' ? r.tagline.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
  }
}
