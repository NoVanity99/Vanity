/** "12 h 5 min", "45 min", "Never played" */
export function formatPlaytime(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? 'Less than a minute' : 'Never played'
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours === 0) return `${minutes} min`
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** "Today", "Yesterday", "3 days ago", or a date. */
export function formatRelativeDate(timestamp: number | null, now = Date.now()): string {
  if (!timestamp) return 'Never'
  const startOfDay = (t: number): number => new Date(t).setHours(0, 0, 0, 0)
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Lowercase without accents, for forgiving search ("pokemon" finds "Pokémon"). */
export function searchKey(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
