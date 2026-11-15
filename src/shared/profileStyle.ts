// How a profile looks to you and to everyone who sees it: a banner behind it, a frame around the
// picture, an effect on the name and a small emoji next to it. Saved to the account.
//
// The server keeps its own copy of the allowed ids (server/src/profileStyle.ts) and refuses
// anything else; a server test checks the two lists stay the same.

export interface ProfileStyle {
  banner: string
  frame: string
  nameStyle: string
  /** One emoji from PROFILE_FLAIRS, or '' for none. */
  flair: string
}

export const DEFAULT_PROFILE_STYLE: ProfileStyle = { banner: 'default', frame: 'none', nameStyle: 'plain', flair: '' }

export const PROFILE_BANNERS = [
  { id: 'default', label: 'Vanity' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'ocean', label: 'Deep sea' },
  { id: 'synthwave', label: 'Synthwave' },
  { id: 'forest', label: 'Forest' },
  { id: 'ember', label: 'Ember' },
  { id: 'galaxy', label: 'Galaxy' },
  { id: 'gold', label: 'Gold rush' },
  { id: 'candy', label: 'Candy' },
  { id: 'storm', label: 'Storm' },
  { id: 'mono', label: 'Mono' },
  { id: 'lava', label: 'Lava' },
  { id: 'mint', label: 'Mint' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'rose', label: 'Rose' },
  { id: 'toxic', label: 'Toxic' },
  { id: 'arctic', label: 'Arctic' },
  { id: 'royal', label: 'Royal' },
  { id: 'peach', label: 'Peach' },
  { id: 'carbon', label: 'Carbon' },
  { id: 'nebula', label: 'Nebula' },
  { id: 'retro', label: 'Retro grid' },
  { id: 'blood', label: 'Blood moon' },
  { id: 'matrix', label: 'Matrix' },
  { id: 'cotton', label: 'Cotton sky' }
] as const

export const PROFILE_FRAMES = [
  { id: 'none', label: 'None' },
  { id: 'accent', label: 'Accent' },
  { id: 'gold', label: 'Gold' },
  { id: 'neon', label: 'Neon' },
  { id: 'ice', label: 'Ice' },
  { id: 'fire', label: 'Fire' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'galaxy', label: 'Galaxy' },
  { id: 'silver', label: 'Silver' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'sapphire', label: 'Sapphire' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'toxic', label: 'Toxic' },
  { id: 'void', label: 'Void' },
  { id: 'pastel', label: 'Pastel' },
  { id: 'plasma', label: 'Plasma' },
  { id: 'candy', label: 'Candy' }
] as const

export const PROFILE_NAME_STYLES = [
  { id: 'plain', label: 'Plain' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'gold', label: 'Gold' },
  { id: 'neon', label: 'Neon glow' },
  { id: 'ice', label: 'Ice' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'fire', label: 'Fire' },
  { id: 'mint', label: 'Mint' },
  { id: 'rose', label: 'Rose' },
  { id: 'silver', label: 'Silver' },
  { id: 'toxic', label: 'Toxic' },
  { id: 'royal', label: 'Royal' },
  { id: 'candy', label: 'Candy' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'lava', label: 'Lava flow' }
] as const

export const PROFILE_FLAIRS = ['', '🎮', '🕹️', '🔥', '⭐', '💎', '🚀', '🌙', '⚡', '🎧', '🏆', '🐉', '🍀', '💀', '🌈', '👾', '🎯', '🧩', '🦊', '🐱', '☕', '🎲', '🏹', '⚔️', '🛡️', '🧙', '👻', '🤖', '👽', '🦄', '🐺', '🦉', '🐼', '🐸', '🦖', '🐙', '🌟', '❄️', '🌊', '🌸', '🍕', '🍩', '🎸', '🎨', '📚', '🏎️', '⚽', '🏀', '🧠', '💜', '🖤', '💚', '☠️', '🥷', '🪐', '🌋'] as const

const ids = (list: readonly { id: string }[]): string[] => list.map((x) => x.id)

/** Whatever was stored or sent, as a complete style with only known values. */
export function normalizeProfileStyle(value: unknown): ProfileStyle {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof ProfileStyle, unknown>>
  const pick = (given: unknown, allowed: readonly string[], fallback: string): string => (typeof given === 'string' && allowed.includes(given) ? given : fallback)
  return {
    banner: pick(v.banner, ids(PROFILE_BANNERS), DEFAULT_PROFILE_STYLE.banner),
    frame: pick(v.frame, ids(PROFILE_FRAMES), DEFAULT_PROFILE_STYLE.frame),
    nameStyle: pick(v.nameStyle, ids(PROFILE_NAME_STYLES), DEFAULT_PROFILE_STYLE.nameStyle),
    flair: pick(v.flair, PROFILE_FLAIRS, DEFAULT_PROFILE_STYLE.flair)
  }
}
