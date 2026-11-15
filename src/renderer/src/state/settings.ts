import { useEffect, useState } from 'react'
import { DEFAULT_INTERFACE, type InterfaceOptions } from '@shared/interfaceOptions'
import type { Settings } from '@shared/types'

/**
 * Settings shared across the UI. Any component that calls saveSettings()
 * updates every useSettings() subscriber.
 */
let current: Settings | null = null
const listeners = new Set<(s: Settings) => void>()

function publish(s: Settings): void {
  current = s
  for (const l of listeners) l(s)
}

// Settings changed on another device arrive through cloud sync.
let subscribed = false
function subscribe(): void {
  if (subscribed) return
  subscribed = true
  window.vanity.settings.onChange(publish)
}

export async function loadSettings(): Promise<Settings> {
  const s = await window.vanity.settings.get()
  publish(s)
  return s
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const s = await window.vanity.settings.update(patch)
  publish(s)
  return s
}

export function useSettings(): Settings | null {
  const [s, setS] = useState<Settings | null>(current)
  useEffect(() => {
    listeners.add(setS)
    subscribe()
    if (!current) void loadSettings().catch(() => {})
    else setS(current)
    return () => {
      listeners.delete(setS)
    }
  }, [])
  return s
}

/** The Customize options (complete, with defaults while settings are still loading). */
export function useInterface(): InterfaceOptions {
  const s = useSettings()
  return s?.interface ?? DEFAULT_INTERFACE
}
