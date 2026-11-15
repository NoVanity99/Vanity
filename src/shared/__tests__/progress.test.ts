import { describe, expect, it } from 'vitest'
import { BADGES, cleanDays, dayOf, levelFor, streaks, summarize, totalXp, xpBreakdown, xpForLevel, type ProgressFacts } from '../progress'
import { XP_CONFIG } from '../xpConfig'

const facts = (over: Partial<ProgressFacts> = {}): ProgressFacts => ({
  playtimeSeconds: 0,
  gamesPlayed: 0,
  launches: 0,
  days: [],
  topGameSeconds: 0,
  gamesBeaten: 0,
  gamesCompleted: 0,
  gamesRated: 0,
  favorites: 0,
  collections: 0,
  steamAchievements: 0,
  ...over
})

describe('levels', () => {
  it('needs 100 XP for level 2 and 100 more for each level after', () => {
    expect([1, 2, 3, 4, 5].map((l) => xpForLevel(l))).toEqual([0, 100, 300, 600, 1000])
    expect(levelFor(0)).toMatchObject({ level: 1, into: 0, span: 100, title: 'Rookie' })
    expect(levelFor(99).level).toBe(1)
    expect(levelFor(100)).toMatchObject({ level: 2, into: 0, span: 200 })
    expect(levelFor(1000)).toMatchObject({ level: 5, title: 'Adventurer' })
  })

  it('follows the config', () => {
    const cfg = { ...XP_CONFIG, levelBase: 50, levelGrowth: 0 }
    expect(levelFor(500, cfg).level).toBe(11)
  })
})

describe('streaks', () => {
  it('counts days in a row, and the best run', () => {
    const s = streaks(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-14'], '2026-11-14')
    expect(s).toMatchObject({ current: 1, best: 3, positions: [1, 2, 3, 1] })
  })

  it('keeps a streak alive until the end of the next day', () => {
    const days = ['2026-11-12', '2026-11-13']
    expect(streaks(days, '2026-11-13').current).toBe(2)
    expect(streaks(days, '2026-11-14').current).toBe(2) // not played yet today
    expect(streaks(days, '2026-11-15').current).toBe(0)
  })

  it('works across months, years and leap days, and ignores repeats and rubbish', () => {
    expect(streaks(['2024-02-28', '2024-02-29', '2024-03-01'], '2024-03-01').best).toBe(3)
    expect(streaks(['2025-12-31', '2026-01-01'], '2026-01-01').current).toBe(2)
    expect(cleanDays(['2026-01-02', '2026-01-02', 'nope', '2026-01-01'])).toEqual(['2026-01-01', '2026-01-02'])
    expect(streaks([], '2026-01-01')).toMatchObject({ current: 0, best: 0 })
  })

  it('names days by the local calendar', () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05')
  })
})

describe('XP', () => {
  it('adds up every source using the numbers in the config', () => {
    const b = xpBreakdown(
      facts({ playtimeSeconds: 3 * 3600 + 59, gamesPlayed: 4, days: ['2026-11-12', '2026-11-13', '2026-11-14'], steamAchievements: 10, gamesBeaten: 1, gamesCompleted: 1, gamesRated: 2 }),
      '2026-11-14'
    )
    expect(b).toEqual({
      playtime: 180 * XP_CONFIG.perMinutePlayed,
      firstLaunches: 4 * XP_CONFIG.firstLaunchOfGame,
      daysPlayed: 3 * XP_CONFIG.perDayPlayed,
      streaks: 0 + XP_CONFIG.streakBonusPerDay + 2 * XP_CONFIG.streakBonusPerDay,
      steamAchievements: 10 * XP_CONFIG.perSteamAchievement,
      journal: XP_CONFIG.gameBeaten + XP_CONFIG.gameCompleted + 2 * XP_CONFIG.gameRated
    })
    expect(totalXp(b)).toBe(180 + 100 + 30 + 15 + 150 + 490)
  })

  it('caps the streak bonus per day', () => {
    const days = Array.from({ length: 40 }, (_, i) => dayOf(Date.UTC(2026, 0, 1 + i, 12)))
    const b = xpBreakdown(facts({ days }), days[39])
    const perDay = days.map((_, i) => Math.min(i * XP_CONFIG.streakBonusPerDay, XP_CONFIG.streakBonusCap))
    expect(b.streaks).toBe(perDay.reduce((a, c) => a + c, 0))
    expect(Math.max(...perDay)).toBe(XP_CONFIG.streakBonusCap)
  })

  it('can be re-tuned without touching anything else', () => {
    const f = facts({ playtimeSeconds: 6000, gamesPlayed: 2 })
    const doubled = { ...XP_CONFIG, perMinutePlayed: 2, firstLaunchOfGame: 0 }
    expect(totalXp(xpBreakdown(f, '2026-01-01', doubled))).toBe(200)
  })
})

describe('badges', () => {
  it('has unique ids that are safe to save', () => {
    const ids = BADGES.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => /^[a-z0-9-]{1,40}$/.test(id))).toBe(true)
  })

  it('earns nothing for doing nothing', () => {
    expect(summarize(facts(), '2026-01-01')).toMatchObject({ xp: 0, earned: [], streak: { current: 0, best: 0 } })
  })

  it('earns badges as their targets are met', () => {
    const s = summarize(facts({ launches: 30, gamesPlayed: 6, playtimeSeconds: 120 * 3600, topGameSeconds: 101 * 3600, days: ['2026-11-12', '2026-11-13', '2026-11-14'], gamesCompleted: 1, collections: 3 }), '2026-11-14')
    expect(s.earned).toEqual(expect.arrayContaining(['first-launch', 'games-5', 'hours-10', 'hours-100', 'one-game-100', 'streak-3', 'finish-1', 'collections-3', 'level-10']))
    expect(s.earned).not.toContain('games-25')
    expect(s.earned).not.toContain('streak-7')
    expect(s.earned).not.toContain('steam-50')
  })

  it('reports progress towards a locked badge, never past its target', () => {
    const b = BADGES.find((x) => x.id === 'games-25')!
    expect(b.measure(facts({ gamesPlayed: 7 }), { level: 1, bestStreak: 0 })).toEqual({ current: 7, target: 25 })
    expect(b.measure(facts({ gamesPlayed: 900 }), { level: 1, bestStreak: 0 })).toEqual({ current: 25, target: 25 })
  })
})
