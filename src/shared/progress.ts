// Levels, streaks and badges, worked out from what you've done. Pure functions: the same code
// runs on Windows and Android, with or without an account.

import { XP_CONFIG, type XpConfig } from './xpConfig'

export interface Level {
  level: number
  /** XP into the current level. */
  into: number
  /** XP the current level takes in total. */
  span: number
  title: string
}

/** XP needed to reach `level` from zero. */
export function xpForLevel(level: number, cfg: XpConfig = XP_CONFIG): number {
  const n = Math.max(0, level - 1)
  // n levels done: base + (base + growth) + … = n·base + growth·n(n−1)/2
  return n * cfg.levelBase + (cfg.levelGrowth * n * (n - 1)) / 2
}

export function levelFor(xp: number, cfg: XpConfig = XP_CONFIG): Level {
  let level = 1
  while (xpForLevel(level + 1, cfg) <= xp && level < 9999) level++
  const base = xpForLevel(level, cfg)
  const title = [...cfg.titles].reverse().find(([min]) => level >= min)?.[1] ?? cfg.titles[0][1]
  return { level, into: xp - base, span: xpForLevel(level + 1, cfg) - base, title }
}

/** A calendar day as YYYY-MM-DD, in the device's own time zone. */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
/** Day number since 1970, treating the date as plain calendar text (no time zones involved). */
function dayNumber(day: string): number {
  return Math.round(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000)
}

/** Valid days only, each once, oldest first. */
export function cleanDays(days: Iterable<string>): string[] {
  return [...new Set([...days].filter((d) => typeof d === 'string' && DAY.test(d)))].sort()
}

export interface Streaks {
  /** Days in a row up to today (or yesterday: today's play may still be coming). */
  current: number
  best: number
  /** For each day played, which day of its streak it was (1 = first). Same order as the cleaned days. */
  positions: number[]
}

export function streaks(days: Iterable<string>, today: string): Streaks {
  const sorted = cleanDays(days)
  const positions: number[] = []
  let best = 0
  let run = 0
  let prev = Number.NaN
  for (const d of sorted) {
    const n = dayNumber(d)
    run = n === prev + 1 ? run + 1 : 1
    prev = n
    positions.push(run)
    if (run > best) best = run
  }
  const last = sorted.length ? dayNumber(sorted[sorted.length - 1]) : Number.NaN
  const t = DAY.test(today) ? dayNumber(today) : Number.NaN
  const current = last === t || last === t - 1 ? run : 0
  return { current, best, positions }
}

/** What a player has done, added up across every device. */
export interface ProgressFacts {
  /** Seconds played, in all. */
  playtimeSeconds: number
  /** Games launched at least once. */
  gamesPlayed: number
  /** Times a game was started. */
  launches: number
  /** Days with any play, as YYYY-MM-DD. */
  days: string[]
  /** Most seconds in a single game. */
  topGameSeconds: number
  gamesBeaten: number
  gamesCompleted: number
  gamesRated: number
  favorites: number
  collections: number
  /** Steam achievements unlocked (0 until a Steam account is linked). */
  steamAchievements: number
}

export interface XpBreakdown {
  playtime: number
  firstLaunches: number
  daysPlayed: number
  streaks: number
  steamAchievements: number
  journal: number
}

export function xpBreakdown(f: ProgressFacts, today: string, cfg: XpConfig = XP_CONFIG): XpBreakdown {
  const s = streaks(f.days, today)
  const streakXp = s.positions.reduce((sum, pos) => sum + Math.min((pos - 1) * cfg.streakBonusPerDay, cfg.streakBonusCap), 0)
  return {
    playtime: Math.floor(f.playtimeSeconds / 60) * cfg.perMinutePlayed,
    firstLaunches: f.gamesPlayed * cfg.firstLaunchOfGame,
    daysPlayed: s.positions.length * cfg.perDayPlayed,
    streaks: streakXp,
    steamAchievements: f.steamAchievements * cfg.perSteamAchievement,
    journal: f.gamesBeaten * cfg.gameBeaten + f.gamesCompleted * cfg.gameCompleted + f.gamesRated * cfg.gameRated
  }
}

export function totalXp(b: XpBreakdown): number {
  return b.playtime + b.firstLaunches + b.daysPlayed + b.streaks + b.steamAchievements + b.journal
}

// ---- badges --------------------------------------------------------------------

export interface BadgeDef {
  id: string
  name: string
  /** What it takes, in plain words. */
  description: string
  /** Icon name (lucide), drawn by the app. */
  icon: 'play' | 'gamepad' | 'library' | 'clock' | 'hourglass' | 'flame' | 'calendar' | 'trophy' | 'crown' | 'star' | 'heart' | 'folder' | 'medal' | 'zap' | 'award'
  /** How far along the player is, and where the badge unlocks. */
  measure(f: ProgressFacts, extra: { level: number; bestStreak: number }): { current: number; target: number }
}

const hours = (s: number): number => Math.floor(s / 3600)
const tier = (id: string, name: string, description: string, icon: BadgeDef['icon'], target: number, value: (f: ProgressFacts, e: { level: number; bestStreak: number }) => number): BadgeDef => ({
  id,
  name,
  description,
  icon,
  measure: (f, e) => ({ current: Math.min(value(f, e), target), target })
})

/** Every badge, in the order the profile page shows them. Ids are saved, so never rename one. */
export const BADGES: BadgeDef[] = [
  tier('first-launch', 'Press Start', 'Launch a game from Vanity.', 'play', 1, (f) => f.launches),
  tier('games-5', 'Sampler', 'Play 5 different games.', 'gamepad', 5, (f) => f.gamesPlayed),
  tier('games-25', 'Explorer', 'Play 25 different games.', 'gamepad', 25, (f) => f.gamesPlayed),
  tier('games-100', 'Connoisseur', 'Play 100 different games.', 'library', 100, (f) => f.gamesPlayed),
  tier('hours-10', 'Warming Up', 'Play for 10 hours in all.', 'clock', 10, (f) => hours(f.playtimeSeconds)),
  tier('hours-100', 'Centurion', 'Play for 100 hours in all.', 'clock', 100, (f) => hours(f.playtimeSeconds)),
  tier('hours-500', 'Marathoner', 'Play for 500 hours in all.', 'hourglass', 500, (f) => hours(f.playtimeSeconds)),
  tier('hours-1000', 'No Life (Affectionate)', 'Play for 1,000 hours in all.', 'hourglass', 1000, (f) => hours(f.playtimeSeconds)),
  tier('one-game-100', 'Main Game', 'Put 100 hours into a single game.', 'heart', 100, (f) => hours(f.topGameSeconds)),
  tier('streak-3', 'Hat Trick', 'Play 3 days in a row.', 'flame', 3, (_f, e) => e.bestStreak),
  tier('streak-7', 'Full Week', 'Play 7 days in a row.', 'flame', 7, (_f, e) => e.bestStreak),
  tier('streak-30', 'Unstoppable', 'Play 30 days in a row.', 'calendar', 30, (_f, e) => e.bestStreak),
  tier('finish-1', 'Roll Credits', 'Mark a game Beaten or Completed.', 'trophy', 1, (f) => f.gamesBeaten + f.gamesCompleted),
  tier('finish-10', 'Backlog Slayer', 'Finish 10 games.', 'trophy', 10, (f) => f.gamesBeaten + f.gamesCompleted),
  tier('complete-5', 'Completionist', 'Mark 5 games Completed.', 'crown', 5, (f) => f.gamesCompleted),
  tier('rate-10', 'Critic', 'Rate 10 games.', 'star', 10, (f) => f.gamesRated),
  tier('collections-3', 'Curator', 'Make 3 collections.', 'folder', 3, (f) => f.collections),
  tier('level-10', 'Veteran', 'Reach level 10.', 'medal', 10, (_f, e) => e.level),
  tier('level-25', 'Elite', 'Reach level 25.', 'medal', 25, (_f, e) => e.level),
  tier('level-50', 'Legendary', 'Reach level 50.', 'award', 50, (_f, e) => e.level),
  tier('steam-50', 'Achievement Hunter', 'Unlock 50 Steam achievements (needs a linked Steam account).', 'zap', 50, (f) => f.steamAchievements)
]

export interface ProgressSummary {
  xp: number
  level: Level
  breakdown: XpBreakdown
  streak: { current: number; best: number }
  /** Ids of the badges whose target is met right now. */
  earned: string[]
}

export function summarize(f: ProgressFacts, today: string, cfg: XpConfig = XP_CONFIG): ProgressSummary {
  const breakdown = xpBreakdown(f, today, cfg)
  const xp = totalXp(breakdown)
  const level = levelFor(xp, cfg)
  const s = streaks(f.days, today)
  const extra = { level: level.level, bestStreak: s.best }
  const earned = BADGES.filter((b) => {
    const m = b.measure(f, extra)
    return m.current >= m.target
  }).map((b) => b.id)
  return { xp, level, breakdown, streak: { current: s.current, best: s.best }, earned }
}
