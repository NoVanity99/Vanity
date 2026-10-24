import { normalizeTitle } from '../metadata/match'

/**
 * How a game is identified to the account server: its normalised title, so
 * your GOG copy and a friend's Steam copy of the same game match.
 */
export function gameKey(name: string): string {
  const n = normalizeTitle(name).replace(/ /g, '-')
  return `g:${n || name.toLowerCase().trim()}`
}
