import type { UpdateNote, UpdateState } from '@shared/types'

/** The parts of electron-updater's autoUpdater this uses (an interface, so tests can fake it). */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, listener: (...args: never[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

interface UpdateInfo {
  version: string
  releaseDate?: string
  releaseNotes?: string | { version: string; note: string | null }[] | null
}

export const FIRST_CHECK_MS = 8_000
export const CHECK_EVERY_MS = 60 * 60_000

/** Release notes (GitHub renders the release text as HTML) as a list of changes. */
export function notesFromRelease(info: UpdateInfo): UpdateNote[] {
  const toChanges = (html: string): string[] => {
    const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1])
    const lines = items.length ? items : html.replace(/<br\s*\/?>|<\/p>|<\/h\d>/gi, '\n').split('\n')
    return lines
      .map((l) =>
        l
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/^\s*[-*]\s+/, '')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean)
  }
  const date = info.releaseDate ? info.releaseDate.slice(0, 10) : null
  const notes = info.releaseNotes
  if (Array.isArray(notes)) return notes.map((n) => ({ version: n.version, date: null, changes: toChanges(n.note ?? '') }))
  const changes = typeof notes === 'string' ? toChanges(notes) : []
  return [{ version: info.version, date, changes: changes.length ? changes : ['Improvements and fixes.'] }]
}

/** What the IPC layer needs from either updater. */
export interface Updater {
  state(): UpdateState
  check(): Promise<UpdateState>
  apply(): Promise<void>
  start(): void
  dispose(): void
}

export interface ReleaseDeps {
  updater: AutoUpdaterLike
  currentVersion: string
  onUpdate(state: UpdateState): void
  log?(message: string): void
}

/**
 * Updates for installed copies (the Windows installer), from GitHub Releases.
 * Checks shortly after launch and every hour, downloads in the background, and
 * offers "Restart to install"; otherwise the update installs when you quit.
 * Failures (offline, GitHub down) only show up as a line in Settings.
 */
export class ReleaseUpdater implements Updater {
  private s: UpdateState
  private timers: ReturnType<typeof setTimeout>[] = []
  private checking: Promise<UpdateState> | null = null

  constructor(private deps: ReleaseDeps) {
    this.s = {
      current: deps.currentVersion,
      latest: null,
      available: false,
      notes: [],
      mode: 'release',
      branch: '',
      source: 'GitHub Releases (NoVanity99/Vanity)',
      checking: false,
      lastChecked: null,
      error: null,
      needsToken: false,
      applying: null,
      progress: null
    }
    const u = deps.updater
    u.autoDownload = true
    u.autoInstallOnAppQuit = true
    u.on('update-available', ((info: UpdateInfo) => this.set({ latest: info.version, notes: notesFromRelease(info), checking: true, progress: 0, error: null })) as never)
    u.on('update-not-available', ((info: UpdateInfo) => this.set({ latest: info?.version ?? this.s.current, checking: false, progress: null, error: null })) as never)
    u.on('download-progress', ((p: { percent?: number }) => this.set({ progress: Math.round(p?.percent ?? 0) })) as never)
    u.on('update-downloaded', ((info: UpdateInfo) =>
      this.set({ latest: info.version, notes: notesFromRelease(info), available: true, checking: false, progress: null, error: null })) as never)
    u.on('error', ((err: Error) => {
      deps.log?.(`[update] ${err?.message ?? err}`)
      this.set({ checking: false, progress: null, error: quietMessage(err) })
    }) as never)
  }

  state(): UpdateState {
    return { ...this.s, notes: this.s.notes.map((n) => ({ ...n, changes: [...n.changes] })) }
  }

  private set(patch: Partial<UpdateState>): void {
    this.s = { ...this.s, ...patch }
    this.deps.onUpdate(this.state())
  }

  start(): void {
    if (this.timers.length) return
    this.timers.push(setTimeout(() => void this.check(), FIRST_CHECK_MS))
    this.timers.push(setInterval(() => void this.check(), CHECK_EVERY_MS))
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  /** Looks for a new release (and downloads it if there is one). Never throws. */
  check(): Promise<UpdateState> {
    if (this.s.available || this.s.applying) return Promise.resolve(this.state())
    this.checking ??= (async () => {
      this.set({ checking: true })
      try {
        await this.deps.updater.checkForUpdates()
      } catch (err) {
        this.deps.log?.(`[update] ${err instanceof Error ? err.message : err}`)
        this.set({ checking: false, progress: null, error: quietMessage(err) })
      } finally {
        this.checking = null
        // A download continues after the check resolves; "checking" stays on until it finishes.
        if (this.s.progress === null) this.set({ checking: false, lastChecked: Date.now() })
        else this.set({ lastChecked: Date.now() })
      }
      return this.state()
    })()
    return this.checking
  }

  /** Restarts into the downloaded version. */
  async apply(): Promise<void> {
    if (!this.s.available) throw new Error('No update has been downloaded yet.')
    this.set({ applying: 'Restarting to install…' })
    this.deps.updater.quitAndInstall(true, true)
  }
}

function quietMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|network|offline|socket/i.test(msg)) return "Couldn't reach GitHub to check for updates. Vanity will try again later."
  if (/404/.test(msg)) return 'No releases found on GitHub yet.'
  return "Couldn't check for updates right now. Vanity will try again later."
}
