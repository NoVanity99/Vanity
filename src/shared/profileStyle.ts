// How a profile looks to you and to everyone who sees it: a banner behind it (with an optional
// animated effect), a frame and an aura around the picture, an effect and a font for the name, a
// small emoji next to it and a title under it. Saved to the account.
//
// The server keeps its own copy of the allowed ids (server/src/profileStyle.ts) and refuses
// anything else; a server test checks the two lists stay the same.

export interface ProfileStyle {
  banner: string
  frame: string
  nameStyle: string
  /** One emoji from PROFILE_FLAIRS, or '' for none. */
  flair: string
  /** The font of the name. */
  nameFont: string
  /** Something moving around the picture. */
  aura: string
  /** Something moving over the banner. */
  effect: string
  /** A title under the name, from PROFILE_TITLES ('' for none). */
  title: string
}

export const DEFAULT_PROFILE_STYLE: ProfileStyle = { banner: 'default', frame: 'none', nameStyle: 'plain', flair: '', nameFont: 'app', aura: 'none', effect: 'none', title: '' }

/** Name fonts (all bundled with the app). `family` is the CSS font list. */
export const PROFILE_NAME_FONTS = [
  { id: 'app', label: 'Vanity', family: '' },
  { id: 'orbitron', label: 'Orbitron', family: "'Orbitron Variable', sans-serif" },
  { id: 'audiowide', label: 'Audiowide', family: "'Audiowide', sans-serif" },
  { id: 'pixel', label: 'Pixel', family: "'Press Start 2P', monospace" },
  { id: 'bebas', label: 'Bebas', family: "'Bebas Neue', sans-serif" },
  { id: 'russo', label: 'Russo', family: "'Russo One', sans-serif" },
  { id: 'rajdhani', label: 'Rajdhani', family: "'Rajdhani', sans-serif" },
  { id: 'chakra', label: 'Chakra', family: "'Chakra Petch', sans-serif" },
  { id: 'oxanium', label: 'Oxanium', family: "'Oxanium Variable', sans-serif" },
  { id: 'kanit', label: 'Kanit', family: "'Kanit', sans-serif" },
  { id: 'playfair', label: 'Playfair', family: "'Playfair Display Variable', Georgia, serif" },
  { id: 'quicksand', label: 'Quicksand', family: "'Quicksand Variable', sans-serif" },
  { id: 'mono', label: 'Mono', family: "'JetBrains Mono Variable', monospace" }
] as const

export const PROFILE_AURAS = [
  { id: 'none', label: 'None' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'halo', label: 'Halo' },
  { id: 'sparkle', label: 'Sparkle' },
  { id: 'flames', label: 'Flames' },
  { id: 'glitch', label: 'Glitch' },
  { id: 'rings', label: 'Ripples' },
  { id: 'prism', label: 'Prism' },
  { id: 'vortex', label: 'Vortex' },
  { id: 'lightning', label: 'Lightning' }
] as const

export const PROFILE_EFFECTS = [
  { id: 'none', label: 'None' },
  { id: 'snow', label: 'Snow' },
  { id: 'stars', label: 'Twinkling stars' },
  { id: 'embers', label: 'Embers' },
  { id: 'hearts', label: 'Hearts' },
  { id: 'bubbles', label: 'Bubbles' },
  { id: 'rain', label: 'Rain' },
  { id: 'fireflies', label: 'Fireflies' },
  { id: 'scanlines', label: 'Scanlines' },
  { id: 'shine', label: 'Shine' },
  { id: 'meteors', label: 'Meteors' }
] as const

/** Titles shown under a name. A fixed list, so no one can put anything rude on their profile. */
export const PROFILE_TITLES = [
  '',
  'Casual gamer',
  'Night owl',
  'Speedrunner',
  'Completionist',
  'Achievement hunter',
  'Co-op buddy',
  'Lone wolf',
  'Tryhard',
  'Chill vibes only',
  'Retro fan',
  'Collector',
  'Explorer',
  'Strategist',
  'Story lover',
  'Indie fan',
  'Boss slayer',
  'Loot goblin',
  'Builder',
  'Racer',
  'Sharpshooter',
  'Healer main',
  'Tank main',
  'Backseat gamer',
  'One more game',
  'AFK',
  'Touch grass later',
  'Professional noob',
  'Main character',
  'Final boss',
  'High roller',
  'Vanity VIP',
  'Legend'
] as const

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
  { id: 'cotton', label: 'Cotton sky' },
  { id: 'obsidian', label: 'Obsidian' },
  { id: 'hologram', label: 'Hologram' },
  { id: 'dragonfire', label: 'Dragonfire' }
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
  { id: 'candy', label: 'Candy' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'inferno', label: 'Inferno' },
  { id: 'celestial', label: 'Celestial' }
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
  { id: 'lava', label: 'Lava flow' },
  { id: 'chrome', label: 'Chrome' },
  { id: 'hologram', label: 'Hologram' }
] as const

export const PROFILE_FLAIRS = ['', '🎮', '🕹️', '🔥', '⭐', '💎', '🚀', '🌙', '⚡', '🎧', '🏆', '🐉', '🍀', '💀', '🌈', '👾', '🎯', '🧩', '🦊', '🐱', '☕', '🎲', '🏹', '⚔️', '🛡️', '🧙', '👻', '🤖', '👽', '🦄', '🐺', '🦉', '🐼', '🐸', '🦖', '🐙', '🌟', '❄️', '🌊', '🌸', '🍕', '🍩', '🎸', '🎨', '📚', '🏎️', '⚽', '🏀', '🧠', '💜', '🖤', '💚', '☠️', '🥷', '🪐', '🌋'] as const

const ids = (list: readonly { id: string }[]): string[] => list.map((x) => x.id)

/** The CSS font list for a name font ('' for the app's own). */
export const nameFontFamily = (id: string | undefined): string => PROFILE_NAME_FONTS.find((f) => f.id === id)?.family ?? ''

/** Whatever was stored or sent, as a complete style with only known values. */
export function normalizeProfileStyle(value: unknown): ProfileStyle {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof ProfileStyle, unknown>>
  const pick = (given: unknown, allowed: readonly string[], fallback: string): string => (typeof given === 'string' && allowed.includes(given) ? given : fallback)
  return {
    banner: pick(v.banner, ids(PROFILE_BANNERS), DEFAULT_PROFILE_STYLE.banner),
    frame: pick(v.frame, ids(PROFILE_FRAMES), DEFAULT_PROFILE_STYLE.frame),
    nameStyle: pick(v.nameStyle, ids(PROFILE_NAME_STYLES), DEFAULT_PROFILE_STYLE.nameStyle),
    flair: pick(v.flair, PROFILE_FLAIRS, DEFAULT_PROFILE_STYLE.flair),
    nameFont: pick(v.nameFont, ids(PROFILE_NAME_FONTS), DEFAULT_PROFILE_STYLE.nameFont),
    aura: pick(v.aura, ids(PROFILE_AURAS), DEFAULT_PROFILE_STYLE.aura),
    effect: pick(v.effect, ids(PROFILE_EFFECTS), DEFAULT_PROFILE_STYLE.effect),
    title: pick(v.title, PROFILE_TITLES, DEFAULT_PROFILE_STYLE.title)
  }
}

/**
 * A look's id in the coin shop: "<part>:<look id>" (e.g. "frame:diamond"). Which looks cost coins,
 * and how much, is decided by the server (server/src/coinBundles.ts), so prices can change
 * without an app update.
 */
export const lookItemId = (part: keyof ProfileStyle, id: string): string => `${part}:${id}`
