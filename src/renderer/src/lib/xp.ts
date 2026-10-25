// Your Vanity gamer level. XP comes from playing (1 per minute) and from finishing
// and rating games, so it only ever goes up.

import type { Game } from '@shared/types'

export const XP_PER_MINUTE = 1
export const XP_BEATEN = 150
export const XP_COMPLETED = 300
export const XP_RATED = 20

export function gameXp(g: Pick<Game, 'playtimeSeconds' | 'playStatus' | 'userRating'>): number {
  const play = Math.floor(g.playtimeSeconds / 60) * XP_PER_MINUTE
  const finish = g.playStatus === 'completed' ? XP_COMPLETED : g.playStatus === 'beaten' ? XP_BEATEN : 0
  return play + finish + (g.userRating ? XP_RATED : 0)
}

export function totalXp(games: Pick<Game, 'playtimeSeconds' | 'playStatus' | 'userRating'>[]): number {
  return games.reduce((n, g) => n + gameXp(g), 0)
}

/** XP needed to reach `level` from zero: 100, 300, 600, 1000… (each level takes 100 more than the last). */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1)
}

export interface Level {
  level: number
  /** XP into the current level. */
  into: number
  /** XP the current level takes in total. */
  span: number
  title: string
}

const TITLES: [number, string][] = [
  [1, 'Rookie'],
  [5, 'Adventurer'],
  [10, 'Veteran'],
  [20, 'Elite'],
  [30, 'Master'],
  [45, 'Grandmaster'],
  [60, 'Legend'],
  [80, 'Mythic']
]

export function levelFor(xp: number): Level {
  let level = 1
  while (xpForLevel(level + 1) <= xp) level++
  const base = xpForLevel(level)
  const title = [...TITLES].reverse().find(([min]) => level >= min)![1]
  return { level, into: xp - base, span: xpForLevel(level + 1) - base, title }
}
