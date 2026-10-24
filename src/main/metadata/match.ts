/** Edition and packaging words that don't change which game it is. */
const EDITION_PHRASES = [
  'game of the year edition',
  'game of the year',
  'goty edition',
  'goty',
  'definitive edition',
  'complete edition',
  'deluxe edition',
  'digital deluxe edition',
  'enhanced edition',
  'ultimate edition',
  'gold edition',
  'standard edition',
  'anniversary edition',
  'directors cut',
  'director s cut'
]

const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' }

/** Reduces a title to comparable words: "The Witcher® 3: Wild Hunt – GOTY" → "the witcher 3 wild hunt". */
export function normalizeTitle(title: string): string {
  let s = title
    .replace(/[\u2122\u00ae\u00a9]/g, '') // ™ ® © — before NFKD, which turns ™ into "TM"
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // accents
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\(\s*\d{4}\s*\)/g, ' ') // "DOOM (2016)"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  for (const phrase of EDITION_PHRASES) s = s.replace(new RegExp(`\\b${phrase}\\b`, 'g'), ' ')
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ROMAN[w] ?? w)
    .join(' ')
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const b = s.slice(i, i + 2)
    m.set(b, (m.get(b) ?? 0) + 1)
  }
  return m
}

function dice(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const A = bigrams(a)
  const B = bigrams(b)
  let overlap = 0
  for (const [k, n] of A) overlap += Math.min(n, B.get(k) ?? 0)
  return (2 * overlap) / (a.length - 1 + (b.length - 1))
}

/** 0–1 similarity of two titles after normalizing. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return 0
  if (na === nb || na.replace(/ /g, '') === nb.replace(/ /g, '')) return 1
  const ta = new Set(na.split(' '))
  const tb = new Set(nb.split(' '))
  const shared = [...ta].filter((t) => tb.has(t)).length
  const jaccard = shared / new Set([...ta, ...tb]).size
  // Numbers matter a lot: "Hades" is not "Hades 2".
  const numsA = [...ta].filter((t) => /^\d+$/.test(t)).join(' ')
  const numsB = [...tb].filter((t) => /^\d+$/.test(t)).join(' ')
  const numberPenalty = numsA !== numsB ? 0.25 : 0
  return Math.max(0, 0.6 * dice(na.replace(/ /g, ''), nb.replace(/ /g, '')) + 0.4 * jaccard - numberPenalty)
}

export const AUTO_MATCH_THRESHOLD = 0.8

/**
 * The candidate that best matches `title`, if it is similar enough to pick
 * automatically. Ties keep the provider's order (it ranks by relevance).
 */
export function pickBestMatch<T>(title: string, candidates: T[], nameOf: (c: T) => string): T | null {
  let best: T | null = null
  let bestScore = 0
  for (const c of candidates) {
    const score = titleSimilarity(title, nameOf(c))
    if (score > bestScore) {
      best = c
      bestScore = score
    }
  }
  return bestScore >= AUTO_MATCH_THRESHOLD ? best : null
}
