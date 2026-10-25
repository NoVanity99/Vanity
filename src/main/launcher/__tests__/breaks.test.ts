import { describe, expect, it, vi } from 'vitest'
import { BreakReminders, breakMessage, remindersDue } from '../breaks'

const MIN = 60_000

describe('break reminders', () => {
  it('counts full intervals', () => {
    expect(remindersDue(0, 59 * MIN, 60)).toBe(0)
    expect(remindersDue(0, 60 * MIN, 60)).toBe(1)
    expect(remindersDue(0, 150 * MIN, 60)).toBe(2)
    expect(remindersDue(0, 999 * MIN, 0)).toBe(0)
    expect(breakMessage('Elden Ring', 90).body).toMatch(/Elden Ring for 1 hour 30 min/)
    expect(breakMessage('X', 120).body).toMatch(/for 2 hours\./)
  })

  it('reminds once per interval during a session, and starts fresh for the next', () => {
    let now = 0
    let running: { id: number; startedAt: number } | null = { id: 1, startedAt: 0 }
    let interval = 60
    const notify = vi.fn()
    const r = new BreakReminders({ running: () => running, gameName: () => 'Hades', intervalMinutes: () => interval, notify, now: () => now })
    r.tick()
    now = 61 * MIN
    r.tick()
    r.tick()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][1]).toMatch(/Hades for 1 hour/)
    now = 121 * MIN
    r.tick()
    expect(notify).toHaveBeenCalledTimes(2)

    // Turned off: nothing; a later session is counted from its own start.
    interval = 0
    now = 500 * MIN
    r.tick()
    interval = 60
    running = { id: 2, startedAt: 480 * MIN }
    r.tick()
    expect(notify).toHaveBeenCalledTimes(2)
    now = 541 * MIN
    r.tick()
    expect(notify).toHaveBeenCalledTimes(3)

    // Turning it on mid-session doesn't fire a backlog.
    const late = vi.fn()
    const r2 = new BreakReminders({ running: () => ({ id: 3, startedAt: 0 }), gameName: () => 'X', intervalMinutes: () => 30, notify: late, now: () => 200 * MIN })
    r2.tick()
    r2.tick()
    expect(late).not.toHaveBeenCalled()
  })
})
