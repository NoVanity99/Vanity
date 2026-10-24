import { timingSafeEqual } from 'node:crypto'

/** The Vanity app, packed at deploy time (see scripts/build-update-bundle.mjs). */
export interface UpdateBundle {
  version: string
  /** CHANGELOG.md, for the app's patch notes. */
  changelog: string
  sha: string | null
  builtAt: number
  size: number
  zipBase64: string
}

/** Compares an update key without leaking how much of it matched. */
export function keyMatches(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? '')
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
