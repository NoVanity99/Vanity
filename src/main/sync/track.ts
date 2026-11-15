/**
 * Wraps a store so `onWrite` runs after any of its methods that change something
 * (every method except the read-only ones named in `reads`).
 */
export function tracked<T extends object>(target: T, reads: (keyof T)[], onWrite: () => void): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver) as unknown
      if (typeof value !== 'function' || reads.includes(prop as keyof T)) return value
      return (...args: unknown[]) => {
        const out = (value as (...a: unknown[]) => unknown).apply(t, args)
        onWrite()
        return out
      }
    }
  })
}
