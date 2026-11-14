// Epic Games through Legendary (https://github.com/derrod/legendary), the open-source Epic
// client. Vanity ships its command-line program and drives it as a separate process: sign-in,
// the list of games you own, downloading, and starting games.
//
// Legendary is GPL-3.0. Vanity only runs the unmodified program; its licence and source link
// are in resources/bin/LEGENDARY-LICENSE.txt.

import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const MIB = 1024 * 1024

/** What one line of Legendary's output tells us. */
export type LegendaryEvent =
  | { type: 'progress'; percent: number; etaSeconds: number }
  | { type: 'downloaded'; bytes: number }
  | { type: 'speed'; bytesPerSecond: number }
  | { type: 'sizes'; kind: 'install' | 'download'; bytes: number }
  | { type: 'path'; path: string }
  | { type: 'finished' }
  /** `specific`: a message Vanity recognises and has reworded, rather than Legendary's own text. */
  | { type: 'error'; message: string; specific: boolean }

const hms = (h: string, m: string, s: string): number => Number(h) * 3600 + Number(m) * 60 + Number(s)

/** Messages Legendary prints that mean something to the user, in plain words. */
const KNOWN_ERRORS: [RegExp, string][] = [
  [/Login failed/i, 'Your Epic sign-in has expired. Sign in to Epic again (Account → Linked accounts).'],
  [/No saved credentials/i, 'Sign in to Epic first (Account → Linked accounts).'],
  [/Could not find ".*" in list of available games/i, "Epic doesn't list this game on your account any more."],
  [/Not enough available disk space/i, "There isn't enough free space on that drive."],
  [/Game is already installed/i, 'Epic says this game is already installed.'],
  [/(ConnectionError|ProxyError|Max retries exceeded|Temporary failure in name resolution|getaddrinfo failed)/i, "Couldn't reach Epic. Check your internet connection and try again."]
]

/**
 * Reads one line of `legendary install` output. The formats are the ones in Legendary's source
 * (legendary/cli.py and legendary/downloader/mp/manager.py).
 */
export function parseLegendaryLine(line: string): LegendaryEvent | null {
  let m = /= Progress: ([\d.]+)% \(\d+\/\d+\), Running for \d+:\d+:\d+, ETA: (\d+):(\d+):(\d+)/.exec(line)
  if (m) return { type: 'progress', percent: Math.min(100, Number(m[1])), etaSeconds: hms(m[2], m[3], m[4]) }
  m = /- Downloaded: ([\d.]+) MiB/.exec(line)
  if (m) return { type: 'downloaded', bytes: Math.round(Number(m[1]) * MIB) }
  m = /\+ Download\s+- ([\d.]+) MiB\/s \(raw\)/.exec(line)
  if (m) return { type: 'speed', bytesPerSecond: Math.round(Number(m[1]) * MIB) }
  m = /\b(Install|Download) size: ([\d.]+) MiB/.exec(line)
  if (m) return { type: 'sizes', kind: m[1] === 'Install' ? 'install' : 'download', bytes: Math.round(Number(m[2]) * MIB) }
  m = /Install path: (.+?)\s*$/.exec(line)
  if (m) return { type: 'path', path: m[1] }
  if (/Finished installation process/.test(line) || /Download size is 0, the game is either already up to date/.test(line)) return { type: 'finished' }
  for (const [pattern, message] of KNOWN_ERRORS) if (pattern.test(line)) return { type: 'error', message, specific: true }
  m = /! Failure: (.+?)\s*$/.exec(line)
  if (m) return { type: 'error', message: m[1], specific: true }
  m = /\[(?:cli|Core|DLManager|DLM)\] (?:ERROR|CRITICAL): (.+?)\s*$/.exec(line)
  if (m) return { type: 'error', message: m[1], specific: false }
  return null
}

export interface EpicGame {
  appName: string
  title: string
  /** Tall cover from Epic's own servers, if it has one. */
  coverUrl: string | null
  heroUrl: string | null
}

export interface EpicInstalled {
  appName: string
  title: string
  installPath: string
  /** Program to start, relative to the install path. */
  executable: string
}

export class LegendaryError extends Error {}

export interface LegendaryDeps {
  /** Full path of the legendary program, or null when this build doesn't have it. */
  binary: string | null
  /** Where Legendary keeps its sign-in and its list of installed games. */
  configDir: string
  spawn: typeof nodeSpawn
  /** Kills a process and everything it started. */
  killTree(pid: number): Promise<unknown>
}

export interface RunningInstall {
  /** Resolves when Legendary says the install is finished; rejects with a message otherwise. */
  done: Promise<void>
  /** Stops the download. Legendary keeps what it has, so starting again continues. */
  stop(): Promise<void>
}

export class Legendary {
  constructor(private deps: LegendaryDeps) {}

  get available(): boolean {
    return !!this.deps.binary
  }

  private env(): NodeJS.ProcessEnv {
    // Its own folder, so Vanity never touches a Legendary or Heroic the user already has.
    return { ...process.env, LEGENDARY_CONFIG_PATH: this.deps.configDir, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
  }

  private start(args: string[]): ChildProcess {
    if (!this.deps.binary) throw new LegendaryError("This build of Vanity doesn't include the Epic downloader.")
    return this.deps.spawn(this.deps.binary, args, { env: this.env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  }

  /** Runs a command to the end. Legendary logs to stderr and prints data (JSON) to stdout. */
  private run(args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess
      try {
        child = this.start(args)
      } catch (err) {
        reject(err)
        return
      }
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        if (child.pid) void this.deps.killTree(child.pid)
        reject(new LegendaryError('Epic took too long to answer. Try again.'))
      }, timeoutMs)
      child.stdout?.setEncoding('utf8').on('data', (d: string) => (stdout += d))
      child.stderr?.setEncoding('utf8').on('data', (d: string) => (stderr += d))
      child.once('error', (err) => {
        clearTimeout(timer)
        reject(new LegendaryError(`Couldn't start the Epic downloader: ${err.message}`))
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        resolve({ code, stdout, stderr })
      })
    })
  }

  /** The most useful thing to tell the user about a failed command: a recognised problem, else `fallback`. */
  private static explain(output: string, fallback: string): string {
    for (const line of output.split(/\r?\n/)) {
      const e = parseLegendaryLine(line)
      if (e?.type === 'error' && e.specific) return e.message
    }
    return fallback
  }

  private static json<T>(stdout: string): T | null {
    // JSON is the last thing printed; warnings may come before it.
    const start = Math.min(...['[', '{'].map((c) => stdout.indexOf(c)).filter((i) => i >= 0))
    if (!Number.isFinite(start)) return null
    try {
      return JSON.parse(stdout.slice(start)) as T
    } catch {
      return null
    }
  }

  /** The Epic account signed in to on this PC, or null. Doesn't go online. */
  async account(): Promise<string | null> {
    if (!this.available) return null
    const { stdout } = await this.run(['status', '--offline', '--json'], 60_000)
    const name = Legendary.json<{ account?: string }>(stdout)?.account
    return name && name !== '<not logged in>' ? name : null
  }

  /** Signs in with the one-time code Epic's sign-in page gives out. Resolves to the account name. */
  async login(code: string): Promise<string> {
    const clean = code.trim().replace(/^"|"$/g, '')
    if (!/^[A-Za-z0-9]{16,64}$/.test(clean)) throw new LegendaryError("That doesn't look like an Epic sign-in code.")
    const { code: exit, stdout, stderr } = await this.run(['auth', '--code', clean], 120_000)
    const name = await this.account()
    if (!name) throw new LegendaryError(Legendary.explain(`${stdout}\n${stderr}`, exit === 0 ? 'Epic sign-in failed. Try again.' : "Epic didn't accept that code. It may have expired: try signing in again."))
    return name
  }

  async logout(): Promise<void> {
    await this.run(['auth', '--delete'], 60_000)
  }

  /** Every game on the Epic account (goes online; the first time can take a minute). */
  async games(): Promise<EpicGame[]> {
    const { stdout, stderr } = await this.run(['list', '--json'], 5 * 60_000)
    const list = Legendary.json<{ app_name?: string; app_title?: string; metadata?: { keyImages?: { type?: string; url?: string }[] } }[]>(stdout)
    if (!Array.isArray(list)) throw new LegendaryError(Legendary.explain(`${stdout}\n${stderr}`, "Couldn't get your Epic library. Try again."))
    return list
      .filter((g) => g.app_name && g.app_title)
      .map((g) => {
        const image = (type: string): string | null => g.metadata?.keyImages?.find((i) => i.type === type && typeof i.url === 'string')?.url ?? null
        return { appName: g.app_name!, title: g.app_title!.trim(), coverUrl: image('DieselGameBoxTall'), heroUrl: image('DieselGameBox') }
      })
  }

  /** How big a game is, before downloading it. */
  async sizes(appName: string): Promise<{ downloadBytes: number; installBytes: number }> {
    const { stdout, stderr } = await this.run(['info', appName, '--json'], 3 * 60_000)
    const info = Legendary.json<{ manifest?: { download_size?: number; disk_size?: number } }>(stdout)
    if (!info?.manifest) throw new LegendaryError(Legendary.explain(`${stdout}\n${stderr}`, "Couldn't get the game's size from Epic."))
    return { downloadBytes: Number(info.manifest.download_size) || 0, installBytes: Number(info.manifest.disk_size) || 0 }
  }

  /** Games Legendary has installed, read straight from its own list (no program is started). */
  async installed(): Promise<EpicInstalled[]> {
    let text: string
    try {
      text = await fs.readFile(join(this.deps.configDir, 'installed.json'), 'utf8')
    } catch {
      return []
    }
    try {
      const data = JSON.parse(text) as Record<string, { title?: string; install_path?: string; executable?: string; is_dlc?: boolean }>
      return Object.entries(data)
        .filter(([, g]) => g && !g.is_dlc && typeof g.install_path === 'string' && g.install_path)
        .map(([appName, g]) => ({ appName, title: g.title ?? appName, installPath: g.install_path!, executable: g.executable ?? '' }))
    } catch {
      return []
    }
  }

  /**
   * Downloads and installs a game into `baseDir` (the game gets its own folder inside).
   * Run it again after stopping and it carries on where it left off.
   */
  install(appName: string, baseDir: string, onEvent: (event: LegendaryEvent) => void, onLine?: (line: string) => void): RunningInstall {
    const child = this.start(['install', appName, '--base-path', baseDir, '-y', '--skip-sdl'])
    let stopped = false
    let finished = false
    let lastError: string | null = null
    let specificError = false
    let buffer = ''
    const feed = (chunk: string): void => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        onLine?.(line)
        const event = parseLegendaryLine(line)
        if (!event) continue
        if (event.type === 'finished') finished = true
        // A recognised problem is kept over the general "cannot proceed" lines that follow it.
        if (event.type === 'error' && (event.specific || !specificError)) {
          lastError = event.message
          specificError ||= event.specific
        }
        onEvent(event)
      }
    }
    child.stdout?.setEncoding('utf8').on('data', feed)
    child.stderr?.setEncoding('utf8').on('data', feed)
    const done = new Promise<void>((resolve, reject) => {
      child.once('error', (err) => reject(new LegendaryError(`Couldn't start the Epic downloader: ${err.message}`)))
      child.once('close', (code) => {
        if (buffer) feed('\n')
        if (stopped) reject(new LegendaryError('stopped'))
        // "Finished" is logged before Legendary's last housekeeping, so trust it over the exit code.
        else if (finished) resolve()
        else reject(new LegendaryError(lastError ?? `The Epic download stopped unexpectedly (code ${code ?? 'none'}).`))
      })
    })
    return {
      done,
      stop: async () => {
        stopped = true
        if (child.pid && child.exitCode === null) await this.deps.killTree(child.pid)
      }
    }
  }

  /** Starts an installed game (Legendary signs it in to Epic's services). */
  launch(appName: string): ChildProcess {
    const child = this.deps.spawn(this.deps.binary!, ['launch', appName], { env: this.env(), windowsHide: true, detached: true, stdio: 'ignore' })
    child.unref()
    return child
  }
}
