import type { Game } from '@shared/types'
import type { LaunchMethod } from './launch'
import { processBelongsTo } from './tracker'

export interface StoppedSession {
  game: Game
  method: LaunchMethod
  state: 'launching' | 'running'
  /** The process Vanity started itself, if it did. */
  pid: number | null
}

export interface StopDeps {
  /** Stops tracking the game and returns what was being tracked (null if nothing was). */
  stopTracking(gameId: number): StoppedSession | null
  /** Running processes with their program paths, or null if they can't be listed. */
  listProcesses(): Promise<{ pid: number; path: string }[] | null>
  /** Force-closes the processes (and what they started). Resolves to how many were closed. */
  kill(pids: number[]): Promise<number>
  /** Closes a web game's window. */
  closeWindow(gameId: number): void
  /** Vanity's own process id: never closed. */
  ownPid: number
}

/**
 * Cancels a game that is starting, or force-closes one that is running (like "End task" in
 * Task Manager). Only processes that clearly belong to the game are closed: its own program,
 * or anything running from its install folder.
 */
export async function stopGame(gameId: number, deps: StopDeps): Promise<{ wasRunning: boolean; closed: number }> {
  const session = deps.stopTracking(gameId)
  if (!session) return { wasRunning: false, closed: 0 }
  const wasRunning = session.state === 'running'
  if (session.method === 'html') {
    deps.closeWindow(gameId)
    return { wasRunning, closed: 1 }
  }
  const pids = new Set<number>()
  if (session.pid) pids.add(session.pid)
  for (const p of (await deps.listProcesses()) ?? []) if (processBelongsTo(p.path, session.game)) pids.add(p.pid)
  pids.delete(deps.ownPid)
  if (pids.size === 0) return { wasRunning, closed: 0 }
  return { wasRunning, closed: await deps.kill([...pids]) }
}
