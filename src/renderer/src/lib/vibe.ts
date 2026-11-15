// Vibe Check: "I have this much time and I'm in this mood, what should I play?"
// Ranks your own library from your habits (how long you usually play each game),
// its genres, where you are in it, your rating and how long it's been.

import type { Game } from '@shared/types'

export type Mood = 'chill' | 'intense' | 'story' | 'quick' | 'social' | 'new'

export const MOODS: { id: Mood; label: string; hint: string }[] = [
  { id: 'chill', label: 'Chill', hint: 'Cozy, relaxed, low stakes' },
  { id: 'intense', label: 'Intense', hint: 'Fast, sweaty, adrenaline' },
  { id: 'story', label: 'Story', hint: 'Get lost in a world' },
  { id: 'quick', label: 'Quick fix', hint: 'Jump in, jump out' },
  { id: 'social', label: 'Social', hint: 'Online and multiplayer' },
  { id: 'new', label: 'Something new', hint: 'Unplayed or backlog' }
]

/** Minutes you have. 240 means "all night". */
export const TIMES = [15, 30, 60, 120, 240] as const

export function timeLabel(minutes: number): string {
  return minutes >= 240 ? 'All night' : minutes < 60 ? `${minutes} min` : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
}

/** Genre words (IGDB and Steam names) that suit each mood. */
const MOOD_GENRES: Record<Exclude<Mood, 'new'>, RegExp> = {
  chill: /simulat|puzzle|casual|card|board|music|point-and-click|visual novel|farming|life|building|sandbox|indie/i,
  intense: /shooter|fighting|hack and slash|beat 'em up|moba|racing|action|roguelike|roguelite|battle royale|platform/i,
  story: /role-playing|rpg|adventure|visual novel|point-and-click|narrative|story/i,
  quick: /arcade|puzzle|roguelike|roguelite|fighting|racing|sport|card|casual|platform|party/i,
  social: /massively multiplayer|mmo|moba|sport|fighting|battle royale|party|co-op|multiplayer/i
}

/** A typical session (minutes) when you've never played a game: by its kind. */
function guessSession(genres: string[]): number {
  const g = genres.join(' ')
  if (MOOD_GENRES.story.test(g)) return 80
  if (/strategy|simulat|mmo|massively/i.test(g)) return 90
  if (MOOD_GENRES.quick.test(g)) return 25
  return 50
}

export interface VibeInput {
  games: Game[]
  /** Your sessions (from play stats): used for how long you usually play each game. */
  sessions: { gameId: number; seconds: number; startedAt: number }[]
  minutes: number
  mood: Mood
  now?: number
  /** Changes the tie-breaking shuffle ("Shuffle" button). */
  seed?: number
}

export interface VibePick {
  game: Game
  /** 0–100. */
  match: number
  /** Why it was picked, best first. */
  reasons: string[]
  /** The session length it expects (minutes). */
  typical: number
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Small deterministic noise in [0, 1) from a game ID and seed. */
function jitter(id: number, seed: number): number {
  let x = (id * 2654435761 + seed * 40503) >>> 0
  x ^= x >>> 15
  x = Math.imul(x, 2246822519) >>> 0
  x ^= x >>> 13
  return (x >>> 0) / 4294967296
}

const fmtMin = (m: number): string => (m >= 90 ? `${Math.round((m / 60) * 10) / 10} h` : `${Math.round(m)} min`)

export function vibeCheck({ games, sessions, minutes, mood, now = Date.now(), seed = 0 }: VibeInput, count = 3): VibePick[] {
  const perGame = new Map<number, number[]>()
  for (const s of sessions) if (s.seconds >= 120) perGame.set(s.gameId, [...(perGame.get(s.gameId) ?? []), s.seconds / 60])
  const DAY = 86_400_000

  const scored = games
    .filter((g) => !g.hidden && !g.missing && g.playStatus !== 'dropped')
    .map((g) => {
      const reasons: { text: string; weight: number }[] = []
      let score = 0
      const genres = g.genres
      const unplayed = g.playtimeSeconds < 60

      // Mood (up to 40).
      if (mood === 'new') {
        if (unplayed) {
          score += 40
          reasons.push({ text: "You haven't played it yet", weight: 40 })
        } else if (g.playStatus === 'backlog') {
          score += 32
          reasons.push({ text: "It's waiting in your backlog", weight: 32 })
        } else if (g.playtimeSeconds < 2 * 3600) {
          score += 18
          reasons.push({ text: `Barely started: only ${fmtMin(g.playtimeSeconds / 60)} so far`, weight: 18 })
        }
      } else {
        const hits = genres.filter((x) => MOOD_GENRES[mood].test(x))
        if (hits.length) {
          const pts = Math.min(40, 24 + hits.length * 8)
          score += pts
          reasons.push({ text: `${MOODS.find((m) => m.id === mood)!.label} pick: ${hits.slice(0, 2).join(', ')}`, weight: pts })
        } else if (genres.length) score -= 15 // Known genres that don't suit the mood: only a fallback.
      }

      // Fits your time (up to 30), from how long you usually play it.
      const mine = perGame.get(g.id)
      const typical = mine && mine.length >= 2 ? median(mine) : guessSession(genres)
      const ratio = typical / minutes
      const fit = minutes >= 240 ? (typical >= 45 ? 1 : 0.6) : Math.max(0, 1 - Math.abs(Math.log2(ratio)) * 0.6)
      score += fit * 30
      if (fit > 0.65) {
        reasons.push({
          text: mine && mine.length >= 2 ? `Your sessions usually run ${fmtMin(typical)}, which fits ${timeLabel(minutes).toLowerCase()}` : `Fits ${timeLabel(minutes).toLowerCase()}`,
          weight: fit * 30
        })
      }

      // Where you are with it (−20 to +15).
      if (g.playStatus === 'playing') {
        score += 15
        reasons.push({ text: "You're in the middle of it", weight: 15 })
      } else if (g.playStatus === 'backlog' && mood !== 'new') {
        score += 8
        reasons.push({ text: 'On your backlog', weight: 8 })
      } else if (g.playStatus === 'beaten') score -= 8
      else if (g.playStatus === 'completed') score -= 20

      // Momentum, or a game you haven't touched in a while (up to 8).
      if (g.lastPlayedAt) {
        const days = (now - g.lastPlayedAt) / DAY
        if (days < 3 && !unplayed) {
          score += 6
          reasons.push({ text: 'You played it recently: keep the streak going', weight: 6 })
        } else if (days > 60) {
          score += 8
          reasons.push({ text: `You haven't played it in ${Math.round(days / 30)} months`, weight: 8 })
        }
      }

      // Your rating (up to 10).
      if (g.userRating) {
        score += g.userRating * 2
        if (g.userRating >= 4) reasons.push({ text: `You rated it ${g.userRating}/5`, weight: g.userRating * 2 })
      }
      if (g.favorite) score += 4

      score += jitter(g.id, seed) * 6
      return { game: g, score, typical, reasons: reasons.sort((a, b) => b.weight - a.weight).map((r) => r.text) }
    })
    .sort((a, b) => b.score - a.score)

  const best = scored[0]?.score ?? 1
  return scored.slice(0, count).map((s) => ({
    game: s.game,
    // Scaled so the top pick reads as a strong match, without ever claiming 100% for a weak library.
    match: Math.max(1, Math.min(99, Math.round((s.score / Math.max(best, 60)) * 96))),
    reasons: s.reasons.slice(0, 3),
    typical: Math.round(s.typical)
  }))
}
