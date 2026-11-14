import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Game } from '@shared/types'
import { Gog, GogError, gogInstallCommand } from './gog'
import type { Legendary } from './legendary'
import { DownloadError, type DownloadDriver, type RunningDownload } from './manager'

/** True when `child` is a folder strictly inside `parent` (never the same folder, never outside). */
export function isStrictlyInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Epic games: downloaded and installed by Legendary. */
export class EpicDriver implements DownloadDriver {
  readonly store = 'epic' as const
  /** Where each game is being installed, learned from Legendary's output (for cleaning up a cancel). */
  private paths = new Map<string, string>()

  constructor(private legendary: Legendary) {}

  sizes(game: Game): Promise<{ downloadBytes: number; installBytes: number }> {
    return this.legendary.sizes(game.externalId)
  }

  run(game: Game, installDir: string, report: Parameters<DownloadDriver['run']>[2], log: (line: string) => void): RunningDownload {
    let total = 0
    const install = this.legendary.install(
      game.externalId,
      installDir,
      (e) => {
        if (e.type === 'sizes' && e.kind === 'download') {
          total = e.bytes
          report({ totalBytes: e.bytes })
        } else if (e.type === 'progress') report({ percent: e.percent, etaSeconds: e.etaSeconds })
        else if (e.type === 'downloaded') report({ downloadedBytes: total ? Math.min(e.bytes, total) : e.bytes })
        else if (e.type === 'speed') report({ speedBps: e.bytesPerSecond })
        else if (e.type === 'path') this.paths.set(game.externalId, e.path)
      },
      log
    )
    return install
  }

  async cleanup(game: Game, installDir: string): Promise<void> {
    const path = this.paths.get(game.externalId)
    this.paths.delete(game.externalId)
    // Only ever a game's own folder inside the folder the user chose.
    if (path && isStrictlyInside(path, installDir)) await fs.rm(path, { recursive: true, force: true })
  }
}

export interface GogDriverDeps {
  gog: Gog
  /** Where installers are kept while they download. */
  tempDir: string
  /** Runs a program to the end and resolves to its exit code. */
  exec(file: string, args: string[]): Promise<number>
}

/** A folder name Windows accepts, from a game title. */
export function folderName(title: string): string {
  return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').trim().slice(0, 80) || 'Game'
}

/** GOG games: their offline installer is downloaded, then run without its windows. */
export class GogDriver implements DownloadDriver {
  readonly store = 'gog' as const

  constructor(private deps: GogDriverDeps) {}

  private temp(game: Game): string {
    return join(this.deps.tempDir, game.externalId)
  }

  async sizes(game: Game): Promise<{ downloadBytes: number; installBytes: number }> {
    const installer = await this.deps.gog.installer(game.externalId)
    // GOG doesn't say how big the installed game is.
    return { downloadBytes: installer.totalBytes, installBytes: 0 }
  }

  run(game: Game, installDir: string, report: Parameters<DownloadDriver['run']>[2], log: (line: string) => void): RunningDownload {
    const abort = new AbortController()
    let installing = false
    const done = (async () => {
      const installer = await this.deps.gog.installer(game.externalId)
      const total = installer.totalBytes
      const dir = this.temp(game)
      await fs.mkdir(dir, { recursive: true })
      report({ totalBytes: total, state: 'downloading' })
      log(`GOG installer "${installer.name}" (${installer.language}), ${installer.files.length} file(s), ${total} bytes`)

      let finishedBytes = 0
      let setup: string | null = null
      // Speed over the last few seconds.
      let windowStart = Date.now()
      let windowBytes = 0
      let lastTotal = 0
      for (const file of installer.files) {
        if (abort.signal.aborted) throw new DownloadError('stopped')
        const { url, filename } = await this.deps.gog.resolve(file)
        const dest = join(dir, filename)
        if (filename.toLowerCase().endsWith('.exe') && !setup) setup = dest
        log(`Downloading ${filename}`)
        await this.deps.gog.download(url, dest, {
          signal: abort.signal,
          expectedSize: file.size || undefined,
          onBytes: (onDisk) => {
            const downloaded = finishedBytes + onDisk
            windowBytes += Math.max(0, downloaded - lastTotal)
            lastTotal = downloaded
            const elapsed = (Date.now() - windowStart) / 1000
            const patch: Parameters<typeof report>[0] = { downloadedBytes: downloaded, percent: total ? Math.min(99, (downloaded / total) * 100) : 0 }
            if (elapsed >= 2) {
              const speed = windowBytes / elapsed
              patch.speedBps = Math.round(speed)
              patch.etaSeconds = speed > 0 && total ? Math.round((total - downloaded) / speed) : null
              windowStart = Date.now()
              windowBytes = 0
            }
            report(patch)
          }
        })
        finishedBytes += file.size || (await fs.stat(dest)).size
        lastTotal = finishedBytes
      }
      if (!setup) throw new DownloadError("GOG's download didn't include an installer program.")

      installing = true
      report({ state: 'installing', percent: 99, speedBps: 0, etaSeconds: null })
      const target = join(installDir, folderName(game.name))
      const command = gogInstallCommand(setup, target)
      log(`Running the installer into ${target}`)
      const code = await this.deps.exec(command.file, command.args)
      if (code !== 0) throw new DownloadError(code === 1 ? "The installer didn't run. If Windows asked for permission, choose Yes, then press Resume." : `The GOG installer stopped with an error (code ${code}).`)
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    })().catch((err) => {
      if (err instanceof GogError || err instanceof DownloadError) throw err
      if (abort.signal.aborted) throw new DownloadError('stopped')
      throw new DownloadError(err instanceof Error ? err.message : 'The GOG download failed.')
    })
    return {
      done,
      stop: async () => {
        // Once the installer is running it is left to finish: stopping it half-way would leave a broken install.
        if (!installing) abort.abort()
        await done.catch(() => {})
      }
    }
  }

  async cleanup(game: Game): Promise<void> {
    await fs.rm(this.temp(game), { recursive: true, force: true })
  }
}
