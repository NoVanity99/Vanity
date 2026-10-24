/**
 * A random pick of up to `count` items, weighted by `hype` so heavier items
 * are picked more often (Efraimidis–Spirakis: sort by random^(1/weight)).
 */
export function weightedSample<T extends { hype: number }>(items: T[], count: number, random = Math.random): T[] {
  return items
    .map((item) => ({ item, key: Math.pow(random(), 1 / Math.max(1, item.hype)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map((x) => x.item)
}
