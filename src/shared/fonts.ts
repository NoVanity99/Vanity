/** Font themes. `body` is used for all text, `display` for big headings. */
export interface FontTheme {
  id: string
  name: string
  /** CSS font-family lists. Fonts other than Segoe UI are bundled with the app. */
  body: string
  display: string
  /** Groups the choices in Settings. */
  group: FontGroup
}

export type FontGroup = 'Clean' | 'Friendly' | 'Gaming' | 'Stylish'
export const FONT_GROUPS: FontGroup[] = ['Clean', 'Friendly', 'Gaming', 'Stylish']

const SEGOE = "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"

/** A font with Segoe UI as the fallback. */
const f = (family: string): string => `'${family}', ${SEGOE}`
const MONO = `'JetBrains Mono Variable', ui-monospace, monospace`

export const FONT_THEMES: FontTheme[] = [
  // Clean
  { id: 'system', name: 'Segoe (Windows)', group: 'Clean', body: SEGOE, display: SEGOE },
  { id: 'inter', name: 'Inter', group: 'Clean', body: f('Inter Variable'), display: f('Inter Variable') },
  { id: 'manrope', name: 'Manrope', group: 'Clean', body: f('Manrope Variable'), display: f('Manrope Variable') },
  { id: 'dmsans', name: 'DM Sans', group: 'Clean', body: f('DM Sans Variable'), display: f('DM Sans Variable') },
  { id: 'jakarta', name: 'Plus Jakarta Sans', group: 'Clean', body: f('Plus Jakarta Sans Variable'), display: f('Plus Jakarta Sans Variable') },
  { id: 'montserrat', name: 'Montserrat', group: 'Clean', body: f('Montserrat Variable'), display: f('Montserrat Variable') },
  { id: 'grotesk', name: 'Space Grotesk', group: 'Clean', body: f('Space Grotesk Variable'), display: f('Space Grotesk Variable') },
  // Friendly
  { id: 'outfit', name: 'Outfit', group: 'Friendly', body: f('Outfit Variable'), display: f('Outfit Variable') },
  { id: 'sora', name: 'Sora', group: 'Friendly', body: f('Sora Variable'), display: f('Sora Variable') },
  { id: 'poppins', name: 'Poppins', group: 'Friendly', body: f('Poppins'), display: f('Poppins') },
  { id: 'nunito', name: 'Nunito', group: 'Friendly', body: f('Nunito Variable'), display: f('Nunito Variable') },
  { id: 'quicksand', name: 'Quicksand', group: 'Friendly', body: f('Quicksand Variable'), display: f('Quicksand Variable') },
  { id: 'lexend', name: 'Lexend', group: 'Friendly', body: f('Lexend Variable'), display: f('Lexend Variable') },
  { id: 'rubik', name: 'Rubik', group: 'Friendly', body: f('Rubik Variable'), display: f('Rubik Variable') },
  // Gaming
  { id: 'arcade', name: 'Arcade (Exo 2 + Orbitron)', group: 'Gaming', body: f('Exo 2 Variable'), display: f('Orbitron Variable') },
  { id: 'esports', name: 'Esports (Rajdhani)', group: 'Gaming', body: f('Rajdhani'), display: f('Rajdhani') },
  { id: 'scifi', name: 'Sci-fi (Oxanium)', group: 'Gaming', body: f('Oxanium Variable'), display: f('Oxanium Variable') },
  { id: 'mecha', name: 'Mecha (Chakra Petch)', group: 'Gaming', body: f('Chakra Petch'), display: f('Chakra Petch') },
  { id: 'racing', name: 'Racing (Russo One + Rubik)', group: 'Gaming', body: f('Rubik Variable'), display: f('Russo One') },
  { id: 'neon', name: 'Neon (Audiowide + Exo 2)', group: 'Gaming', body: f('Exo 2 Variable'), display: f('Audiowide') },
  { id: 'retro', name: 'Retro (Press Start 2P + Inter)', group: 'Gaming', body: f('Inter Variable'), display: f('Press Start 2P') },
  { id: 'terminal', name: 'Terminal (JetBrains Mono)', group: 'Gaming', body: MONO, display: MONO },
  // Stylish
  { id: 'poster', name: 'Poster (Bebas Neue + Montserrat)', group: 'Stylish', body: f('Montserrat Variable'), display: f('Bebas Neue') },
  { id: 'sporty', name: 'Sporty (Kanit)', group: 'Stylish', body: f('Kanit'), display: f('Kanit') },
  { id: 'editorial', name: 'Editorial (Playfair + DM Sans)', group: 'Stylish', body: f('DM Sans Variable'), display: `'Playfair Display Variable', Georgia, serif` }
]

export const DEFAULT_FONT = 'system'

export function fontById(id: string | undefined): FontTheme {
  return FONT_THEMES.find((f) => f.id === id) ?? FONT_THEMES[0]
}
