import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'

/** The updater's state, shared by the title-bar button, the banner and Settings. */
let current: UpdateState | null = null
const listeners = new Set<(s: UpdateState) => void>()
let subscribed = false

function publish(s: UpdateState): void {
  current = s
  for (const l of listeners) l(s)
}

function subscribe(): void {
  if (subscribed) return
  subscribed = true
  window.vanity.update.onChange(publish)
  window.vanity.update.state().then(publish, () => {})
}

export function useUpdate(): UpdateState | null {
  const [s, setS] = useState<UpdateState | null>(current)
  useEffect(() => {
    listeners.add(setS)
    subscribe()
    if (current) setS(current)
    return () => {
      listeners.delete(setS)
    }
  }, [])
  return s
}

export async function checkForUpdate(): Promise<UpdateState> {
  const s = await window.vanity.update.check()
  publish(s)
  return s
}

/** How many versions are waiting (the red badge). */
export function pendingCount(s: UpdateState | null): number {
  return s?.available ? Math.max(1, s.notes.length) : 0
}

// Opening the update window from anywhere (button, banner, Settings).
const openers = new Set<() => void>()
export function onOpenUpdateDialog(fn: () => void): () => void {
  openers.add(fn)
  return () => openers.delete(fn)
}
export function openUpdateDialog(): void {
  for (const fn of openers) fn()
}
