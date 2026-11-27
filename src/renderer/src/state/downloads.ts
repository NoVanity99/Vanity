import { useEffect, useState } from 'react'
import type { DownloadItem, Game, StoreAccounts } from '@shared/types'

/** The download queue, shared by the Downloads page and the sidebar. */
let items: DownloadItem[] | null = null
const itemListeners = new Set<(i: DownloadItem[]) => void>()
let subscribed = false

function publish(next: DownloadItem[]): void {
  items = next
  for (const l of itemListeners) l(next)
}

export function useDownloads(): DownloadItem[] {
  const [list, setList] = useState<DownloadItem[]>(items ?? [])
  useEffect(() => {
    itemListeners.add(setList)
    if (!subscribed) {
      subscribed = true
      window.vanity.downloads.onChange(publish)
      void window.vanity.downloads.list().then(publish, () => {})
    } else if (items) setList(items)
    return () => {
      itemListeners.delete(setList)
    }
  }, [])
  return list
}

/** The Epic and GOG accounts linked on this PC. */
export function useStores(): StoreAccounts | null {
  const [state, setState] = useState<StoreAccounts | null>(null)
  useEffect(() => {
    window.vanity.stores.state().then(setState, () => {})
    return window.vanity.stores.onChange(setState)
  }, [])
  return state
}

/** Stores whose games Vanity downloads and installs itself (Steam games go to the Steam client). */
export function installsInVanity(game: Pick<Game, 'source'>): boolean {
  // Vanity's own downloads install the Windows versions (GOG's installers, Legendary for Epic):
  // on a Mac, games install through their own launchers.
  if (window.vanity.os === 'darwin') return false
  return game.source === 'epic' || game.source === 'gog'
}

// The install window can be opened from anywhere (a card, the game page, the right-click menu).
const openers = new Set<(game: Game) => void>()
export function openInstallDialog(game: Game): void {
  for (const fn of openers) fn(game)
}
export function onOpenInstallDialog(fn: (game: Game) => void): () => void {
  openers.add(fn)
  return () => {
    openers.delete(fn)
  }
}

export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '0 MB'
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb >= 100 ? Math.round(gb) : gb.toFixed(1)} GB`
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}

export function formatSpeed(bytesPerSecond: number): string {
  const mb = bytesPerSecond / 1024 ** 2
  if (mb >= 1) return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB/s`
  return `${Math.max(0, Math.round(bytesPerSecond / 1024))} KB/s`
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return ''
  if (seconds < 60) return 'less than a minute left'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h === 0) return `${m} min left`
  return `${h} h ${m} min left`
}
