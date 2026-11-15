import type { Game, GameSource } from './types'

/** The same title in two places ("Hades" on Steam and Epic) compares equal: case, accents, ™/® and punctuation are ignored. */
export function nameKey(name: string): string {
  return name
    .replace(/[™®©]/g, '') // before normalising, which would turn ™ into the letters "TM"
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // accents
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
}

/** When two copies tie on everything else, the one from the launcher higher in this list is shown. */
const SOURCE_ORDER: GameSource[] = ['steam', 'epic', 'gog', 'ea', 'ubisoft', 'android', 'custom', 'manual']

/** Higher is better: installed on this device, found by the last scan, then the copy you've played most, your favourite, then by launcher. */
function better(a: Game, b: Game): Game {
  if (a.installed !== b.installed) return a.installed ? a : b
  if (a.missing !== b.missing) return a.missing ? b : a
  if (a.hidden !== b.hidden) return a.hidden ? b : a
  if (a.playtimeSeconds !== b.playtimeSeconds) return a.playtimeSeconds > b.playtimeSeconds ? a : b
  if (a.favorite !== b.favorite) return a.favorite ? a : b
  const sa = SOURCE_ORDER.indexOf(a.source)
  const sb = SOURCE_ORDER.indexOf(b.source)
  if (sa !== sb) return sa < sb ? a : b
  return a.id <= b.id ? a : b
}

/**
 * One entry per game name: if the same game is found twice (two launchers, or a
 * launcher and a custom folder), only the best copy is shown. Order is kept.
 */
export function dedupeByName(games: Game[]): Game[] {
  const best = new Map<string, Game>()
  for (const g of games) {
    const key = nameKey(g.name) || `#${g.id}`
    const current = best.get(key)
    best.set(key, current ? better(current, g) : g)
  }
  const keep = new Set([...best.values()].map((g) => g.id))
  return games.filter((g) => keep.has(g.id))
}
