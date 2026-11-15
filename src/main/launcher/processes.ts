import { execFile } from 'node:child_process'

/**
 * Lists the executable paths of running processes. Paths of processes owned
 * by other users or by the system are not visible, which is fine: games run
 * as the current user. Returns null if the list could not be read.
 */
export function listProcessPaths(): Promise<string[] | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  const command =
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
    'Get-Process | ForEach-Object { $_.Path } | Where-Object { $_ } | Sort-Object -Unique'
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err) {
          console.warn('[processes] could not list processes:', err.message)
          resolve(null)
          return
        }
        resolve(
          stdout
            .replace(/^﻿/, '')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
        )
      }
    )
  })
}

/** Running processes with their ids and program paths (the current user's only). Null if they can't be listed. */
export function listProcesses(): Promise<{ pid: number; path: string }[] | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  const command =
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
    'Get-Process | Where-Object { $_.Path } | ForEach-Object { "$($_.Id)`t$($_.Path)" }'
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      if (err) {
        console.warn('[processes] could not list processes:', err.message)
        resolve(null)
        return
      }
      resolve(parseProcessList(stdout))
    })
  })
}

/** Parses "pid<TAB>path" lines. */
export function parseProcessList(stdout: string): { pid: number; path: string }[] {
  const out: { pid: number; path: string }[] = []
  for (const line of stdout.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const tab = line.indexOf('\t')
    const pid = Number(line.slice(0, tab))
    const path = line.slice(tab + 1).trim()
    if (tab > 0 && Number.isInteger(pid) && pid > 0 && path) out.push({ pid, path })
  }
  return out
}

/**
 * Force-closes processes and everything they started, like "End task" in Task Manager.
 * Resolves to how many of the given processes were closed.
 */
export function killProcesses(pids: number[]): Promise<number> {
  const valid = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))]
  if (valid.length === 0) return Promise.resolve(0)
  if (process.platform !== 'win32') {
    let closed = 0
    for (const pid of valid) {
      try {
        process.kill(pid, 'SIGKILL')
        closed++
      } catch {
        // Already gone, or not ours to close.
      }
    }
    return Promise.resolve(closed)
  }
  return new Promise((resolve) => {
    execFile('taskkill.exe', [...valid.flatMap((pid) => ['/PID', String(pid)]), '/T', '/F'], { windowsHide: true, timeout: 15_000, encoding: 'utf8' }, (_err, stdout) => {
      // taskkill reports each process it ended on its own line (it exits with an error if any was already gone).
      const ended = (String(stdout).match(/SUCCESS/gi) ?? []).length
      resolve(Math.min(valid.length, ended))
    })
  })
}
