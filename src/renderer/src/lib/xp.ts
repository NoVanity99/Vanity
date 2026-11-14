// XP a single game contributes (playtime, finishing, rating), for the session recap and Wrapped.
// Your full level (which also counts first launches, days played and streaks) comes from
// useProgress(). Every number lives in src/shared/xpConfig.ts.

import type { Game } from '@shared/types'
import { XP_CONFIG } from '@shared/xpConfig'

export { levelFor, xpForLevel, type Level } from '@shared/progress'

export function gameXp(g: Pick<Game, 'playtimeSeconds' | 'playStatus' | 'userRating'>): number {
  const play = Math.floor(g.playtimeSeconds / 60) * XP_CONFIG.perMinutePlayed
  const finish = g.playStatus === 'completed' ? XP_CONFIG.gameCompleted : g.playStatus === 'beaten' ? XP_CONFIG.gameBeaten : 0
  return play + finish + (g.userRating ? XP_CONFIG.gameRated : 0)
}

export function totalXp(games: Pick<Game, 'playtimeSeconds' | 'playStatus' | 'userRating'>[]): number {
  return games.reduce((n, g) => n + gameXp(g), 0)
}
