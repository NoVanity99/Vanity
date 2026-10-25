import { useEffect, useState } from 'react'
import type { Collection } from '@shared/types'

/** Your collections, shared by the sidebar, the library and the Collections dialog. */
let current: Collection[] | null = null
const listeners = new Set<(c: Collection[]) => void>()

function publish(c: Collection[]): void {
  current = c
  for (const l of listeners) l(c)
}

export async function reloadCollections(): Promise<Collection[]> {
  const list = await window.vanity.collections.list()
  publish(list)
  return list
}

export function useCollections(): Collection[] {
  const [c, setC] = useState<Collection[]>(current ?? [])
  useEffect(() => {
    listeners.add(setC)
    if (!current) void reloadCollections().catch(() => {})
    else setC(current)
    return () => {
      listeners.delete(setC)
    }
  }, [])
  return c
}

/** Creates a collection; throws with a readable message (e.g. a duplicate name). */
export async function createCollection(name: string): Promise<Collection> {
  const res = await window.vanity.collections.create(name)
  if (res.error !== undefined) throw new Error(res.error)
  await reloadCollections()
  return res.data
}

export async function renameCollection(id: number, name: string): Promise<void> {
  const res = await window.vanity.collections.rename(id, name)
  if (res.error !== undefined) throw new Error(res.error)
  await reloadCollections()
}

export async function deleteCollection(id: number): Promise<void> {
  await window.vanity.collections.remove(id)
  await reloadCollections()
}
