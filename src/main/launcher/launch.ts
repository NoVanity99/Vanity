import { spawn, type ChildProcess } from 'node:child_process'
import { dirname } from 'node:path'
import type { Game } from '@shared/types'
import { pathExists } from '../util/fs'

export type LaunchMethod = 'uri' | 'exe'

export interface LaunchResult {
  method: LaunchMethod
  /** Present when Vanity started the exe itself, so its exit can be watched. */
  child?: ChildProcess
}

/** A failure with a message that can be shown to the user as-is. */
export class LaunchError extends Error {}

export interface LaunchDeps {
  openExternal(url: string): Promise<void>
  /** ShellExecute an exe; resolves to an error message, or '' on success. Triggers UAC when the exe needs it. */
  openPath(path: string): Promise<string>
  spawn: typeof spawn
  exists(path: string): Promise<boolean>
}

export function launchUri(game: Game): string | null {
  if (game.source === 'steam') return `steam://rungameid/${game.externalId}`
  if (game.source === 'epic') {
    return `com.epicgames.launcher://apps/${encodeURIComponent(game.externalId)}?action=launch&silent=true`
  }
  return null
}

/** Windows error codes that mean "this exe must run as administrator". */
const NEEDS_ELEVATION = new Set(['EACCES', 'EPERM', 'UNKNOWN', 'ELEVATION_REQUIRED'])

function spawnDetached(exe: string, deps: LaunchDeps): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = deps.spawn(exe, [], {
      // Games load their data relative to the working directory.
      cwd: dirname(exe),
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    child.once('spawn', () => {
      // Let the game outlive Vanity.
      child.unref()
      resolve(child)
    })
    child.once('error', reject)
  })
}

export async function launchGame(game: Game, deps: LaunchDeps): Promise<LaunchResult> {
  const uri = launchUri(game)
  if (uri) {
    try {
      await deps.openExternal(uri)
    } catch {
      const launcher = game.source === 'steam' ? 'Steam' : 'the Epic Games Launcher'
      throw new LaunchError(`Couldn't start ${launcher}. Is it installed?`)
    }
    return { method: 'uri' }
  }

  const exe = game.executablePath
  if (!exe) throw new LaunchError(`Vanity doesn't know which program starts ${game.name}. Use Edit metadata to set it.`)
  if (!(await deps.exists(exe))) {
    throw new LaunchError(`Couldn't find ${exe}. The game may have been moved or uninstalled.`)
  }

  try {
    return { method: 'exe', child: await spawnDetached(exe, deps) }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? ''
    if (!NEEDS_ELEVATION.has(code)) throw new LaunchError(`Couldn't start ${game.name}: ${(err as Error).message}`)
    // Probably needs admin rights: let Windows show the UAC prompt.
    const error = await deps.openPath(exe)
    if (error) throw new LaunchError(`Couldn't start ${game.name}: ${error}`)
    return { method: 'exe' }
  }
}

export const defaultExists = pathExists
