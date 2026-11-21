// Words Vanity doesn't allow in usernames, and hides in comments. A basic filter: it catches the
// plain spellings and the usual letter swaps (a→4/@, i→1/!, o→0, e→3, s→5/$), not every trick.

const BLOCKED = [
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'dick', 'cock', 'pussy', 'whore', 'slut', 'bastard', 'wanker', 'twat',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'tranny', 'kike', 'chink', 'spic', 'gook', 'coon', 'dyke', 'paki',
  'rape', 'rapist', 'nazi', 'hitler', 'kkk', 'pedo', 'pedophile', 'porn', 'cum', 'jizz', 'penis', 'vagina', 'dildo'
]

/** Names nobody may take: they look official. */
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'vanity', 'vanityteam', 'vanitysupport', 'support', 'staff', 'system', 'official', 'owner', 'developer', 'someone', 'deleted', 'null', 'undefined']

const SWAPS: Record<string, string> = { '4': 'a', '@': 'a', '1': 'i', '!': 'i', '|': 'i', '0': 'o', '3': 'e', '5': 's', $: 's', '7': 't', '8': 'b' }
const plain = (text: string): string => [...text.toLowerCase()].map((ch) => SWAPS[ch] ?? ch).join('')

/**
 * Words that are also inside ordinary ones (peacock, grape, raccoon, spice, cucumber…): in a
 * username these only count when they stand alone ("a_fag_b"). The rest count anywhere.
 */
const SHORT = new Set(['fag', 'cum', 'kkk', 'cock', 'dick', 'rape', 'coon', 'spic', 'paki', 'dyke', 'kike', 'gook', 'twat'])

/** Why a username isn't allowed, or null when it is fine. `own` are official names this account may keep. */
export function usernameProblem(username: string): string | null {
  const squashed = plain(username).replace(/[^a-z]/g, '')
  if (RESERVED.includes(squashed) || RESERVED.includes(username.toLowerCase())) return 'That username is reserved. Pick another one.'
  for (const w of BLOCKED) {
    if (SHORT.has(w) ? squashed === w || plain(username).split(/[^a-z]+/).includes(w) : squashed.includes(w)) return "That username isn't allowed. Pick another one."
  }
  return null
}

const WORD = new RegExp(`(?<![a-z])(${[...BLOCKED].sort((a, b) => b.length - a.length).join('|')})(s|es|ed|er|ers|ing)?(?![a-z])`, 'g')

/** Text with blocked words starred out ("what the ****"). Everything else is left exactly as typed. */
export function maskProfanity(text: string): string {
  // Matched on the "plain" spelling, which has the same length, so the stars land on the right letters.
  const flat = plain(text)
  let out = ''
  let at = 0
  for (const m of flat.matchAll(WORD)) {
    out += text.slice(at, m.index) + '*'.repeat(m[0].length)
    at = m.index + m[0].length
  }
  return out + text.slice(at)
}
