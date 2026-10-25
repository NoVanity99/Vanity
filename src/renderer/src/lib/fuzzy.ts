import { searchKey } from './format'

/**
 * How well `query` matches `text` (higher is better; 0 = no match).
 * Whole-text prefix > word prefix > substring > letters in order ("wt3" → "The Witcher 3").
 */
export function matchScore(query: string, text: string): number {
  const q = searchKey(query.trim())
  if (!q) return 1
  const t = searchKey(text)
  if (t === q) return 1000
  if (t.startsWith(q)) return 800 - t.length
  const words = t.split(/[^a-z0-9]+/).filter(Boolean)
  if (words.some((w) => w.startsWith(q))) return 600 - t.length
  const at = t.indexOf(q)
  if (at >= 0) return 400 - at - t.length / 10
  // Initials and letters in order, with a bonus for each one that starts a word.
  let i = 0
  let bonus = 0
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) {
      if (j === 0 || !/[a-z0-9]/.test(t[j - 1])) bonus += 10
      i++
    }
  }
  return i === q.length ? 100 + bonus - t.length / 10 : 0
}
