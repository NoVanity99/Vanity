import type { Game } from '@shared/types'

/** Weight: games you haven't played in a while (or ever) come up more often. */
function weight(g: Game, now: number): number {
  if (!g.lastPlayedAt) return 4
  const days = (now - g.lastPlayedAt) / 86_400_000
  return 1 + Math.min(3, days / 30)
}

/** A random visible, installed game, weighted towards ones you haven't played lately. */
export function pickSurprise(games: Game[], random = Math.random, now = Date.now()): Game | null {
  const pool = games.filter((g) => !g.hidden && !g.missing)
  const total = pool.reduce((sum, g) => sum + weight(g, now), 0)
  let r = random() * total
  for (const g of pool) {
    r -= weight(g, now)
    if (r <= 0) return g
  }
  return pool.at(-1) ?? null
}
