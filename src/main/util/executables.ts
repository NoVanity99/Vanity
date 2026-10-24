import { basename, dirname, join, relative, sep } from 'node:path'
import { fileSize, safeReaddir } from './fs'

/**
 * File names (without .exe) that are almost never the game itself:
 * uninstallers, crash reporters, redistributables, launchers and helpers.
 */
const JUNK_NAME_PATTERNS: RegExp[] = [
  /^unins\d*$/,
  /uninstall/,
  /crash/,
  /bugsplat/,
  /report/,
  /redist/,
  /^vc_?redist/,
  /^dxsetup$/,
  /^dxwebsetup$/,
  /directx/,
  /dotnet/,
  /^ndp\d/,
  /^oalinst$/,
  /physx/,
  /setup/,
  /install/,
  /prereq/,
  /launcher/,
  /^update/,
  /updater/,
  /patcher/,
  /easyanticheat/,
  /battleye/,
  /^beservice/,
  /helper/,
  /^cefsharp/,
  /subprocess/,
  /webengine/,
  /webhelper/,
  /^dotnetfx/,
  /^7za?$/,
  /^unrar$/,
  /^pythonw?$/,
  /^node$/,
  /^cmd$/,
  /^conhost$/,
  /touchup/,
  /cleanup/,
  /activation/,
  /^register/
]

/** Folder names whose contents are support files rather than games. */
const JUNK_DIRS = new Set([
  '_commonredist',
  'commonredist',
  'redist',
  'redistributables',
  '_redist',
  'redistributable',
  '__installer',
  'installer',
  'installers',
  'support',
  'directx',
  'dotnet',
  'vcredist',
  'prerequisites',
  'prereqs',
  'easyanticheat',
  'battleye',
  'thirdparty',
  'crashreporter',
  '$recycle.bin',
  'system volume information'
])

export function isJunkDirName(name: string): boolean {
  return JUNK_DIRS.has(name.toLowerCase())
}

/** True when an .exe path looks like an uninstaller, crash reporter, redistributable, etc. */
export function isLikelyNotGame(exePath: string, root?: string): boolean {
  const name = basename(exePath).toLowerCase().replace(/\.exe$/, '')
  if (JUNK_NAME_PATTERNS.some((re) => re.test(name))) return true
  const rel = root ? relative(root, dirname(exePath)) : dirname(exePath)
  return rel.split(/[\\/]/).some((part) => part && isJunkDirName(part))
}

export interface FindOptions {
  maxDepth?: number
  maxFiles?: number
}

/** Recursively lists .exe files under a folder, skipping known support folders. */
export async function findExecutables(root: string, opts: FindOptions = {}): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? 4
  const maxFiles = opts.maxFiles ?? 200
  const found: string[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (found.length >= maxFiles) return
    const entries = await safeReaddir(dir)
    for (const entry of entries) {
      if (found.length >= maxFiles) return
      const full = join(dir, entry.name)
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
        found.push(full)
      } else if (entry.isDirectory() && depth < maxDepth && !isJunkDirName(entry.name)) {
        await walk(full, depth + 1)
      }
    }
  }

  await walk(root, 0)
  return found
}

/** Lowercase alphanumerics only, for loose name comparisons. */
export function compactName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Ranks the plausible game executables in a folder, best first. Prefers files
 * whose name resembles the game or folder name, Unreal "-Shipping" builds,
 * shallow paths and larger files.
 */
export async function rankExecutables(root: string, gameName?: string): Promise<string[]> {
  const exes = (await findExecutables(root)).filter((p) => !isLikelyNotGame(p, root))
  const targets = [gameName, basename(root)].filter(Boolean).map((s) => compactName(s!))

  const scored = await Promise.all(
    exes.map(async (exe) => {
      const name = compactName(basename(exe, '.exe').replace(/-win64-shipping$/i, ''))
      const depth = relative(root, exe).split(sep).length - 1
      let score = 0
      for (const t of targets) {
        if (!t || !name) continue
        if (name === t) score += 100
        else if (t.includes(name) || name.includes(t)) score += 50
        else if (t.slice(0, 4) === name.slice(0, 4)) score += 15
      }
      if (/-shipping\.exe$/i.test(exe)) score += 20
      if (/(^|[\\/])(win64|x64|bin64|binaries)([\\/]|$)/i.test(exe)) score += 5
      if (/(32|x86)\.exe$/i.test(exe)) score -= 5
      score -= depth * 3
      const size = await fileSize(exe)
      score += Math.min(20, Math.log2(Math.max(size, 1) / 1024 / 1024 + 1) * 4)
      return { exe, score }
    })
  )

  return scored.sort((a, b) => b.score - a.score).map((s) => s.exe)
}

/** The best guess for a folder's main game executable, or null. */
export async function pickMainExecutable(root: string, gameName?: string): Promise<string | null> {
  const [best] = await rankExecutables(root, gameName)
  return best ?? null
}

/** Turns "the_witcher-3_GOTY" or "HadesII" into a readable title. */
export function prettifyName(raw: string): string {
  return raw
    .replace(/\.exe$/i, '')
    .replace(/[_.]+/g, ' ')
    .replace(/-win64-shipping$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

const GENERIC_DIRS = /^(bin|bin32|bin64|binaries|win32|win64|x64|x86|game|games|retail|release|shipping|windows|windowsnoeditor)$/i

/** A readable game name for an exe: the nearest non-generic folder name, else the file name. */
export function nameFromExecutable(exePath: string): string {
  let dir = dirname(exePath)
  for (let i = 0; i < 4; i++) {
    const name = basename(dir)
    if (!name || dirname(dir) === dir) break
    if (!GENERIC_DIRS.test(name)) return prettifyName(name)
    dir = dirname(dir)
  }
  return prettifyName(basename(exePath))
}
