import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** readdir that returns [] instead of throwing (missing folder, no permission…). */
export async function safeReaddir(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

export async function safeReadFile(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8')
  } catch {
    return null
  }
}

export async function fileSize(p: string): Promise<number> {
  try {
    return (await fs.stat(p)).size
  } catch {
    return 0
  }
}

/**
 * Total size of the files under a folder, in bytes. Symlinks aren't followed.
 * Stops counting after `maxEntries` entries so a huge tree can't stall it; `complete` says whether it finished.
 */
export async function folderSize(root: string, maxEntries = 400_000): Promise<{ bytes: number; complete: boolean }> {
  let bytes = 0
  let seen = 0
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    const entries = await safeReaddir(dir)
    const files: string[] = []
    for (const e of entries) {
      if (++seen > maxEntries) return { bytes, complete: false }
      const p = join(dir, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile()) files.push(p)
    }
    // Stat in small batches: fast, without opening thousands of handles at once.
    for (let i = 0; i < files.length; i += 64) {
      const sizes = await Promise.all(files.slice(i, i + 64).map(fileSize))
      for (const n of sizes) bytes += n
    }
  }
  return { bytes, complete: true }
}
