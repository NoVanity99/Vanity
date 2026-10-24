import { describe, expect, it } from 'vitest'
import { formatBytes, formatHours } from '../format'
import { byHour, byWeekday, favouriteTime, longestStreak, milestones, playedDays, playedWithin, streak } from '../playtime'

const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m, d, h).getTime()

describe('playtime maths', () => {
  const sessions = [
    { startedAt: at(2026, 0, 1, 23), seconds: 3600 },
    { startedAt: at(2026, 0, 2, 9), seconds: 1800 },
    { startedAt: at(2026, 0, 3, 2), seconds: 5 * 3600 },
    { startedAt: at(2026, 0, 3, 20), seconds: 600 },
    { startedAt: at(2026, 0, 10, 20), seconds: 600 }
  ]

  it('counts days, streaks and recent time', () => {
    expect(playedDays(sessions)).toBe(4)
    expect(longestStreak(sessions)).toBe(3)
    expect(streak(sessions, at(2026, 0, 11))).toBe(1) // yesterday counts
    expect(streak(sessions, at(2026, 0, 12))).toBe(0)
    expect(playedWithin(sessions, 7, at(2026, 0, 11))).toBe(600)
  })

  it('buckets by hour and weekday', () => {
    const hours = byHour(sessions)
    expect(hours[2]).toBe(5 * 3600)
    expect(hours[20]).toBe(1200)
    expect(favouriteTime(hours)).toBe('Late nights')
    expect(favouriteTime(Array(24).fill(0))).toBeNull()
    // 2026-01-01 is a Thursday (index 3 when Monday is 0).
    expect(byWeekday(sessions)[3]).toBe(3600)
  })

  it('awards milestones', () => {
    const list = milestones({ playtimeSeconds: 8 * 3600, playStatus: 'beaten', firstPlayedAt: at(2026, 0, 1), sessions }, at(2026, 0, 11))
    const get = (id: string) => list.find((m) => m.id === id)!
    expect(get('first').unlocked).toBe(true)
    expect(get('hooked')).toMatchObject({ unlocked: false, progress: 0.8 })
    expect(get('marathon').unlocked).toBe(true)
    expect(get('roll').unlocked).toBe(true)
    expect(get('owl').unlocked).toBe(true)
    expect(get('finisher').unlocked).toBe(true)
    expect(get('perfect').unlocked).toBe(false)
  })

  it('formats hours and sizes', () => {
    expect(formatHours(90 * 60)).toBe('1.5 h')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(150 * 1024 ** 3)).toBe('150 GB')
  })
})
