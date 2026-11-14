import type { UpdateState } from '@shared/types'
import { compareVersions, notesSince, parseChangelog } from '../main/update/changelog'

const REPO = 'NoVanity99/Vanity'
const LATEST_YML = `https://github.com/${REPO}/releases/latest/download/latest.yml`
const CHANGELOG = `https://raw.githubusercontent.com/${REPO}/HEAD/CHANGELOG.md`
/** The newest APK always has this address. */
export const APK_URL = `https://github.com/${REPO}/releases/latest/download/Vanity.apk`
const CHECK_EVERY_MS = 60 * 60_000

export interface MobileUpdateDeps {
  currentVersion: string
  fetchText(url: string): Promise<string>
  openUrl(url: string): Promise<void>
  onUpdate(state: UpdateState): void
  now?: () => number
}

/**
 * Updates on Android. Vanity checks GitHub Releases (the same place the Windows app updates from).
 * Android doesn't let an app replace itself silently, so "Update" downloads the new APK and
 * Android asks you to install it.
 */
export class MobileUpdater {
  private s: UpdateState
  private timer: ReturnType<typeof setInterval> | null = null
  private checking: Promise<UpdateState> | null = null

  constructor(private deps: MobileUpdateDeps) {
    this.s = {
      current: deps.currentVersion,
      latest: null,
      available: false,
      notes: [],
      mode: 'apk',
      branch: '',
      source: `GitHub Releases (${REPO})`,
      checking: false,
      lastChecked: null,
      error: null,
      needsToken: false,
      applying: null,
      progress: null
    }
  }

  state(): UpdateState {
    return { ...this.s, notes: this.s.notes.map((n) => ({ ...n, changes: [...n.changes] })) }
  }

  private set(patch: Partial<UpdateState>): void {
    this.s = { ...this.s, ...patch }
    this.deps.onUpdate(this.state())
  }

  start(): void {
    if (this.timer) return
    setTimeout(() => void this.check(), 5000)
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  check(): Promise<UpdateState> {
    this.checking ??= (async () => {
      this.set({ checking: true })
      const now = (this.deps.now ?? Date.now)()
      try {
        const yml = await this.deps.fetchText(LATEST_YML)
        const latest = /^version:\s*(\S+)/m.exec(yml)?.[1] ?? null
        if (!latest || compareVersions(latest, this.s.current) <= 0) {
          this.set({ latest: latest ?? this.s.current, available: false, notes: [], checking: false, lastChecked: now, error: null })
        } else {
          const changelog = await this.deps.fetchText(CHANGELOG).catch(() => '')
          const notes = notesSince(parseChangelog(changelog), this.s.current, latest)
          this.set({
            latest,
            available: true,
            notes: notes.length ? notes : [{ version: latest, date: null, changes: ['Improvements and fixes.'] }],
            checking: false,
            lastChecked: now,
            error: null
          })
        }
      } catch {
        this.set({ checking: false, lastChecked: now, error: "Couldn't check for updates right now. Vanity will try again later." })
      } finally {
        this.checking = null
      }
      return this.state()
    })()
    return this.checking
  }

  /** Starts the APK download; Android then offers to install it. */
  async apply(): Promise<void> {
    if (!this.s.available) throw new Error('There is no update to install.')
    await this.deps.openUrl(APK_URL)
  }
}
