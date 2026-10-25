// The numbers behind Vanity Wrapped: your last 12 months of play.

import type { Game } from '@shared/types'
import { longestStreak, playedDays } from './playtime'

export interface WrappedSession {
  startedAt: number
  seconds: number
  gameId: number
}

export interface Wrapped {
  totalSeconds: number
  sessions: number
  daysPlayed: number
  gamesPlayed: number
  /** Up to five, most played first. */
  topGames: { game: Game; seconds: number }[]
  topGenre: { name: string; seconds: number; share: number } | null
  busiestMonth: { label: string; seconds: number } | null
  busiestWeekday: string | null
  /** Share of sessions started between 10 pm and 5 am, and between 5 and 9 am. */
  nightOwl: number
  earlyBird: number
  longestSession: { game: Game; seconds: number; at: number } | null
  longestStreak: number
  /** Games you played for the first time this year. */
  newGames: number
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function computeWrapped(all: WrappedSession[], games: Game[], now = Date.now(), firstSeen?: Map<number, number>): Wrapped {
  const since = now - 365 * 86_400_000
  const sessions = all.filter((s) => s.startedAt >= since && s.seconds > 0)
  const byId = new Map(games.map((g) => [g.id, g]))
  const perGame = new Map<number, number>()
  const perGenre = new Map<string, number>()
  const perMonth = new Map<string, { label: string; seconds: number }>()
  const perWeekday = Array<number>(7).fill(0)
  let night = 0
  let morning = 0
  let longest: WrappedSession | null = null
  for (const s of sessions) {
    perGame.set(s.gameId, (perGame.get(s.gameId) ?? 0) + s.seconds)
    for (const genre of byId.get(s.gameId)?.genres ?? []) perGenre.set(genre, (perGenre.get(genre) ?? 0) + s.seconds)
    const d = new Date(s.startedAt)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    const m = perMonth.get(key) ?? { label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), seconds: 0 }
    m.seconds += s.seconds
    perMonth.set(key, m)
    perWeekday[d.getDay()] += s.seconds
    const h = d.getHours()
    if (h >= 22 || h < 5) night++
    else if (h < 9) morning++
    if (byId.has(s.gameId) && (!longest || s.seconds > longest.seconds)) longest = s
  }
  const totalSeconds = sessions.reduce((n, s) => n + s.seconds, 0)
  const topGames = [...perGame]
    .flatMap(([id, seconds]) => (byId.has(id) ? [{ game: byId.get(id)!, seconds }] : []))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5)
  const genre = [...perGenre].sort((a, b) => b[1] - a[1])[0]
  const month = [...perMonth.values()].sort((a, b) => b.seconds - a.seconds)[0]
  const weekday = perWeekday.some((v) => v > 0) ? WEEKDAYS[perWeekday.indexOf(Math.max(...perWeekday))] : null
  // A game is "new" if its first-ever session falls in the period.
  const first = firstSeen ?? new Map<number, number>()
  if (!firstSeen) for (const s of all) if (!first.has(s.gameId) || s.startedAt < first.get(s.gameId)!) first.set(s.gameId, s.startedAt)
  return {
    totalSeconds,
    sessions: sessions.length,
    daysPlayed: playedDays(sessions),
    gamesPlayed: perGame.size,
    topGames,
    topGenre: genre && totalSeconds ? { name: genre[0], seconds: genre[1], share: genre[1] / totalSeconds } : null,
    busiestMonth: month ?? null,
    busiestWeekday: weekday,
    nightOwl: sessions.length ? night / sessions.length : 0,
    earlyBird: sessions.length ? morning / sessions.length : 0,
    longestSession: longest ? { game: byId.get(longest.gameId)!, seconds: longest.seconds, at: longest.startedAt } : null,
    longestStreak: longestStreak(sessions),
    newGames: [...perGame.keys()].filter((id) => (first.get(id) ?? 0) >= since).length
  }
}
