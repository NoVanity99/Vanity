/** How many reminders a session should have had by `now` (one per full interval played). */
export function remindersDue(startedAt: number, now: number, intervalMinutes: number): number {
  if (intervalMinutes <= 0 || now <= startedAt) return 0
  return Math.floor((now - startedAt) / (intervalMinutes * 60_000))
}

export function breakMessage(game: string, minutes: number): { title: string; body: string } {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const time = h ? `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} min` : ''}` : `${m} minutes`
  return { title: 'Time for a break?', body: `You've been playing ${game} for ${time}. Stretch, drink some water, rest your eyes.` }
}

export interface BreakDeps {
  running(): { id: number; startedAt: number } | null
  gameName(id: number): string | null
  intervalMinutes(): number
  notify(title: string, body: string): void
  now?: () => number
}

/** Gently reminds you to take a break every N minutes while a game runs (Settings → Wellbeing). */
export class BreakReminders {
  private session: string | null = null
  private sent = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private deps: BreakDeps) {}

  start(): void {
    this.timer ??= setInterval(() => this.tick(), 30_000)
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  tick(): void {
    const run = this.deps.running()
    const interval = this.deps.intervalMinutes()
    if (!run || interval <= 0) {
      this.session = null
      return
    }
    const now = (this.deps.now ?? Date.now)()
    const key = `${run.id}:${run.startedAt}`
    if (key !== this.session) {
      // A new session; if the setting was just turned on mid-session, don't fire a backlog of reminders.
      this.session = key
      this.sent = remindersDue(run.startedAt, now, interval)
      return
    }
    const due = remindersDue(run.startedAt, now, interval)
    if (due > this.sent) {
      this.sent = due
      const { title, body } = breakMessage(this.deps.gameName(run.id) ?? 'your game', due * interval)
      this.deps.notify(title, body)
    }
  }
}
