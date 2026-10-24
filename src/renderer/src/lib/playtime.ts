// Playtime maths shared by the Stats page and game pages. Days are bucketed in local time.

export interface SessionLike {
  startedAt: number
  seconds: number
}

const DAY = 86_400_000

export const dayKey = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Seconds played per local day for the last `days` days, oldest first. */
export function perDay(sessions: SessionLike[], days: number, now = Date.now()): { label: string; date: Date; seconds: number }[] {
  const totals = new Map<string, number>()
  for (const s of sessions) totals.set(dayKey(s.startedAt), (totals.get(dayKey(s.startedAt)) ?? 0) + s.seconds)
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(now)
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - (days - 1 - i))
    return { label: date.toLocaleDateString(undefined, { weekday: 'narrow' }), date, seconds: totals.get(dayKey(date.getTime())) ?? 0 }
  })
}

/** Days in a row, ending today (or yesterday), with at least one session. */
export function streak(sessions: SessionLike[], now = Date.now()): number {
  const played = new Set(sessions.map((s) => dayKey(s.startedAt)))
  const d = new Date(now)
  if (!played.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1)
  let n = 0
  while (played.has(dayKey(d.getTime()))) {
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
}

/** The longest run of consecutive days with a session, ever. */
export function longestStreak(sessions: SessionLike[]): number {
  const days = [...new Set(sessions.map((s) => new Date(s.startedAt).setHours(12, 0, 0, 0)))].sort((a, b) => a - b)
  let best = 0
  let run = 0
  for (let i = 0; i < days.length; i++) {
    // ±2 h absorbs daylight-saving shifts.
    run = i > 0 && Math.abs(days[i] - days[i - 1] - DAY) < 2 * 3_600_000 ? run + 1 : 1
    best = Math.max(best, run)
  }
  return best
}

/** Number of different days with a session. */
export function playedDays(sessions: SessionLike[]): number {
  return new Set(sessions.map((s) => dayKey(s.startedAt))).size
}

/** Seconds played in sessions that started within the last `days` days. */
export function playedWithin(sessions: SessionLike[], days: number, now = Date.now()): number {
  return sessions.reduce((sum, s) => (s.startedAt >= now - days * DAY ? sum + s.seconds : sum), 0)
}

/** Seconds played by the hour a session started (0–23). */
export function byHour(sessions: SessionLike[]): number[] {
  const out = Array<number>(24).fill(0)
  for (const s of sessions) out[new Date(s.startedAt).getHours()] += s.seconds
  return out
}

/** Seconds played by weekday, Monday first. */
export function byWeekday(sessions: SessionLike[]): number[] {
  const out = Array<number>(7).fill(0)
  for (const s of sessions) out[(new Date(s.startedAt).getDay() + 6) % 7] += s.seconds
  return out
}

/** "Evenings", "Late nights"… for the busiest part of the day, or null with no sessions. */
export function favouriteTime(hours: number[]): string | null {
  const parts: [string, number[]][] = [
    ['Mornings', [5, 6, 7, 8, 9, 10, 11]],
    ['Afternoons', [12, 13, 14, 15, 16]],
    ['Evenings', [17, 18, 19, 20, 21]],
    ['Late nights', [22, 23, 0, 1, 2, 3, 4]]
  ]
  let best: string | null = null
  let most = 0
  for (const [name, hs] of parts) {
    const total = hs.reduce((sum, h) => sum + hours[h], 0)
    if (total > most) {
      most = total
      best = name
    }
  }
  return best
}

export interface Milestone {
  id: string
  title: string
  description: string
  unlocked: boolean
  /** 0–1 towards unlocking, for locked ones that can be counted. */
  progress: number | null
}

export interface MilestoneInput {
  playtimeSeconds: number
  playStatus: string | null
  firstPlayedAt: number | null
  sessions: SessionLike[]
}

/** Little achievements Vanity awards for a game, from your own play. */
export function milestones({ playtimeSeconds, playStatus, firstPlayedAt, sessions }: MilestoneInput, now = Date.now()): Milestone[] {
  const h = playtimeSeconds / 3600
  const hours = sessions.map((s) => new Date(s.startedAt).getHours())
  const longest = Math.max(0, ...sessions.map((s) => s.seconds))
  const days = playedDays(sessions)
  const run = longestStreak(sessions)
  const ratio = (v: number, goal: number): number => Math.min(1, v / goal)
  const list: Milestone[] = []
  const add = (id: string, title: string, description: string, unlocked: boolean, progress: number | null): void =>
    void list.push({ id, title, description, unlocked, progress: unlocked ? 1 : progress })

  add('first', 'First steps', 'Play it for the first time', playtimeSeconds > 0, null)
  add('hooked', 'Hooked', 'Play for 10 hours', h >= 10, ratio(h, 10))
  add('dedicated', 'Dedicated', 'Play for 50 hours', h >= 50, ratio(h, 50))
  add('centurion', 'Centurion', 'Play for 100 hours', h >= 100, ratio(h, 100))
  add('marathon', 'Marathon', 'Play 4 hours in one sitting', longest >= 4 * 3600, ratio(longest, 4 * 3600))
  add('regular', 'Regular', 'Play on 7 different days', days >= 7, ratio(days, 7))
  add('roll', 'On a roll', 'Play 3 days in a row', run >= 3, ratio(run, 3))
  add('owl', 'Night owl', 'Start a session between midnight and 5 am', hours.some((x) => x < 5), null)
  add('bird', 'Early bird', 'Start a session between 5 and 8 am', hours.some((x) => x >= 5 && x < 8), null)
  add('veteran', 'Veteran', 'Keep playing a year after you started', !!firstPlayedAt && now - firstPlayedAt >= 365 * DAY && playtimeSeconds > 0, firstPlayedAt ? ratio(now - firstPlayedAt, 365 * DAY) : null)
  add('finisher', 'Finisher', 'Mark it as beaten', playStatus === 'beaten' || playStatus === 'completed', null)
  add('perfect', 'Perfectionist', 'Mark it as 100% completed', playStatus === 'completed', null)
  return list
}
