import { useEffect, useState } from 'react'
import type { Progress } from '@shared/types'

/** Your level, XP, badges and cloud-sync state, shared by every screen that shows them. */
let current: Progress | null = null
const listeners = new Set<(p: Progress) => void>()
let subscribed = false

function publish(p: Progress): void {
  current = p
  for (const l of listeners) l(p)
}

function subscribe(): void {
  if (subscribed) return
  subscribed = true
  window.vanity.progress.onChange(publish)
  void window.vanity.progress.get().then(publish, () => {})
}

export async function reloadProgress(): Promise<void> {
  publish(await window.vanity.progress.get())
}

export async function syncNow(): Promise<Progress> {
  const p = await window.vanity.progress.syncNow()
  publish(p)
  return p
}

export function useProgress(): Progress | null {
  const [p, setP] = useState<Progress | null>(current)
  useEffect(() => {
    listeners.add(setP)
    subscribe()
    if (current) setP(current)
    return () => {
      listeners.delete(setP)
    }
  }, [])
  return p
}
