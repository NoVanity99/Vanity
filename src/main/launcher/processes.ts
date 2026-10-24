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
