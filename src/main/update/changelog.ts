import type { UpdateNote } from '@shared/types'

/** Compares "1.2.10" and "1.2.9" numerically. Returns <0, 0 or >0. Extra labels ("-beta") are ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] => v.replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0)
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/**
 * Reads CHANGELOG.md: one "## 1.2.0 (2026-10-24)" heading per version
 * (the date is optional), followed by "- change" bullets.
 */
export function parseChangelog(text: string): UpdateNote[] {
  const notes: UpdateNote[] = []
  let current: UpdateNote | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^##\s+v?(\d+\.\d+\.\d+[\w.-]*)\s*(?:[-–—(]\s*(\d{4}-\d{2}-\d{2})\)?)?/.exec(line)
    if (heading) {
      current = { version: heading[1], date: heading[2] ?? null, changes: [] }
      notes.push(current)
      continue
    }
    if (!current) continue
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet) current.changes.push(bullet[1].trim())
    // A wrapped bullet continues on the next indented line.
    else if (line && /^\s{2,}/.test(raw) && current.changes.length) current.changes[current.changes.length - 1] += ` ${line}`
  }
  return notes
}

/** Notes for versions newer than `current` (up to and including `latest`), newest first. */
export function notesSince(notes: UpdateNote[], current: string, latest: string | null): UpdateNote[] {
  return notes
    .filter((n) => compareVersions(n.version, current) > 0 && (!latest || compareVersions(n.version, latest) <= 0))
    .sort((a, b) => compareVersions(b.version, a.version))
}
