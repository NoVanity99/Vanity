/** localStorage that never throws (it can be unavailable or full). For UI conveniences only. */
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`vanity:${key}`)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`vanity:${key}`, JSON.stringify(value))
  } catch {
    // ignore
  }
}
