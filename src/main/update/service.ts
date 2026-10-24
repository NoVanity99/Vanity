import { createHash } from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateState } from '@shared/types'
import { HttpError, NetworkError, request, type FetchFn } from '../metadata/http'
import { compareVersions, notesSince, parseChangelog } from './changelog'

/** How often to look for a new version. */
export const CHECK_INTERVAL_MS = 60_000

/** Never overwritten by an update: dependencies, builds, git data and your keys. */
const KEEP = new Set(['node_modules', '.git', 'out', 'dist', '.env.local'])

export interface UpdateDeps {
  /** The project folder (holds package.json). */
  root: string
  fetchFn: FetchFn
  getToken(): string
  /** Runs a program and resolves to its stdout; rejects with its stderr when it fails. */
  exec(cmd: string, args: string[], opts: { cwd: string; timeoutMs?: number }): Promise<string>
  /** Unpacks a .zip into a folder. */
  unzip(zipFile: string, dest: string): Promise<void>
  tmpDir: string
  /** Running from source with `npm run dev`: electron-vite rebuilds and restarts by itself. */
  isDev: boolean
  /** False for installed (packaged) builds, which can't update from source. */
  supported: boolean
  onUpdate(state: UpdateState): void
  /** Starts the new version. */
  restart(): void
  now?: () => number
}

interface Config {
  version: string
  repo: string
  branch: string
}

function readConfig(root: string): Config {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string; vanity?: { repo?: string; updateBranch?: string } }
  return { version: pkg.version ?? '0.0.0', repo: pkg.vanity?.repo ?? 'NoVanity99/Vanity', branch: pkg.vanity?.updateBranch ?? 'main' }
}

async function fileHash(file: string): Promise<string | null> {
  try {
    return createHash('sha256').update(await fs.readFile(file)).digest('hex')
  } catch {
    return null
  }
}

/**
 * Keeps Vanity up to date from its GitHub repo. A git clone updates with git
 * (using your normal GitHub login); a downloaded copy uses the GitHub API with
 * a token. Checks every minute; applying pulls the new code, installs new
 * dependencies if there are any, rebuilds and restarts.
 */
export class UpdateService {
  private s: UpdateState
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<UpdateState> | null = null
  private remote = 'origin'
  /** GitHub API: last answers by URL, so unchanged files cost nothing (304s don't count against the rate limit). */
  private etags = new Map<string, { etag: string; body: string }>()
  private readonly now: () => number

  constructor(private deps: UpdateDeps) {
    this.now = deps.now ?? Date.now
    const cfg = readConfig(deps.root)
    this.s = {
      current: cfg.version,
      latest: null,
      available: false,
      notes: [],
      mode: deps.supported ? (existsSync(join(deps.root, '.git')) ? 'git' : 'github') : 'unsupported',
      branch: cfg.branch,
      checking: false,
      lastChecked: null,
      error: null,
      needsToken: false,
      applying: null
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
    if (this.timer || this.s.mode === 'unsupported') return
    void this.init().then(() => this.check())
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** In a clone, follow the branch it tracks (falls back to the configured one). Without git installed, use the API. */
  private async init(): Promise<void> {
    if (this.s.mode !== 'git') return
    try {
      await this.git(['--version'])
      const upstream = (await this.git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => '')).trim()
      const slash = upstream.indexOf('/')
      if (slash > 0) {
        this.remote = upstream.slice(0, slash)
        this.s.branch = upstream.slice(slash + 1)
      }
    } catch {
      this.s.mode = 'github'
    }
  }

  private git(args: string[], timeoutMs = 60_000): Promise<string> {
    return this.deps.exec('git', args, { cwd: this.deps.root, timeoutMs })
  }

  /** Looks for a new version now. Concurrent calls share one check. Never throws. */
  check(): Promise<UpdateState> {
    if (this.s.mode === 'unsupported' || this.s.applying) return Promise.resolve(this.state())
    this.inFlight ??= (async () => {
      this.set({ checking: true })
      try {
        const current = readConfig(this.deps.root).version
        const found = this.s.mode === 'git' ? await this.checkGit(current) : await this.checkGithub(current)
        this.set({ ...found, current, checking: false, lastChecked: this.now(), error: null })
      } catch (err) {
        this.set({ checking: false, lastChecked: this.now(), error: describe(err) })
      } finally {
        this.inFlight = null
      }
      return this.state()
    })()
    return this.inFlight
  }

  private async checkGit(current: string): Promise<Pick<UpdateState, 'latest' | 'available' | 'notes' | 'needsToken'>> {
    const ref = `${this.remote}/${this.s.branch}`
    await this.git(['fetch', '--quiet', '--no-tags', this.remote, this.s.branch])
    const behind = Number((await this.git(['rev-list', '--count', `HEAD..${ref}`])).trim()) || 0
    if (behind === 0) return { latest: current, available: false, notes: [], needsToken: false }
    const latest = (JSON.parse(await this.git(['show', `${ref}:package.json`])) as { version?: string }).version ?? current
    const changelog = await this.git(['show', `${ref}:CHANGELOG.md`]).catch(() => '')
    let notes = notesSince(parseChangelog(changelog), current, latest)
    if (notes.length === 0) {
      // No changelog entry: list the commit titles instead.
      const subjects = (await this.git(['log', '--format=%s', `HEAD..${ref}`])).split('\n').map((l) => l.trim()).filter(Boolean)
      notes = [{ version: latest, date: null, changes: subjects }]
    }
    return { latest, available: true, notes, needsToken: false }
  }

  private async api(path: string, accept = 'application/vnd.github.raw+json'): Promise<string> {
    const url = `https://api.github.com/repos/${readConfig(this.deps.root).repo}${path}`
    const cached = this.etags.get(url)
    const res = await this.deps.fetchFn(url, {
      headers: {
        Accept: accept,
        Authorization: `Bearer ${this.deps.getToken()}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(cached ? { 'If-None-Match': cached.etag } : {})
      },
      signal: AbortSignal.timeout(20_000)
    }).catch((err) => {
      throw new NetworkError(err instanceof Error ? err.message : String(err))
    })
    if (res.status === 304 && cached) return cached.body
    if (!res.ok) throw new HttpError(res.status, `GitHub answered ${res.status}`)
    const body = await res.text()
    const etag = res.headers.get('etag')
    if (etag) this.etags.set(url, { etag, body })
    return body
  }

  private async checkGithub(current: string): Promise<Pick<UpdateState, 'latest' | 'available' | 'notes' | 'needsToken'>> {
    if (!this.deps.getToken()) return { latest: null, available: false, notes: [], needsToken: true }
    const ref = encodeURIComponent(this.s.branch)
    const latest = (JSON.parse(await this.api(`/contents/package.json?ref=${ref}`)) as { version?: string }).version ?? current
    if (compareVersions(latest, current) <= 0) return { latest, available: false, notes: [], needsToken: false }
    const changelog = await this.api(`/contents/CHANGELOG.md?ref=${ref}`).catch(() => '')
    const notes = notesSince(parseChangelog(changelog), current, latest)
    return { latest, available: true, notes: notes.length ? notes : [{ version: latest, date: null, changes: ['Improvements and fixes.'] }], needsToken: false }
  }

  /** Installs the new version and restarts. Throws (and reports in state) if something fails. */
  async apply(): Promise<void> {
    if (this.s.applying) return
    if (!this.s.available) throw new Error('There is no update to install.')
    const lock = join(this.deps.root, 'package-lock.json')
    const before = await fileHash(lock)
    try {
      this.set({ applying: 'Downloading the update…', error: null })
      if (this.s.mode === 'git') await this.pullGit()
      else await this.downloadGithub()

      if ((await fileHash(lock)) !== before) {
        this.set({ applying: 'Installing new dependencies…' })
        await this.deps.exec('npm', ['install', '--no-audit', '--no-fund'], { cwd: this.deps.root, timeoutMs: 10 * 60_000 }).catch((err) => {
          throw new Error(`Installing dependencies failed. Close Vanity, run "npm install" in its folder, then start it again. (${describe(err)})`)
        })
      }
      if (!this.deps.isDev) {
        this.set({ applying: 'Building the new version…' })
        await this.deps.exec('npx', ['electron-vite', 'build'], { cwd: this.deps.root, timeoutMs: 10 * 60_000 })
      }
      this.set({ applying: 'Restarting…', available: false })
      this.deps.restart()
    } catch (err) {
      this.set({ applying: null, error: describe(err) })
      throw err
    }
  }

  private async pullGit(): Promise<void> {
    const ref = `${this.remote}/${this.s.branch}`
    await this.git(['fetch', '--quiet', '--no-tags', this.remote, this.s.branch])
    // npm rewrites the lockfile locally now and then; that must not block the update (npm install redoes it).
    await this.git(['checkout', '--', 'package-lock.json']).catch(() => {})
    try {
      await this.git(['merge', '--ff-only', ref])
    } catch (err) {
      throw new Error(`Your copy has local changes that clash with the update, so it wasn't applied. ${describe(err)}`)
    }
  }

  private async downloadGithub(): Promise<void> {
    const work = join(this.deps.tmpDir, `vanity-update-${this.now()}`)
    await fs.mkdir(work, { recursive: true })
    try {
      const url = `https://api.github.com/repos/${readConfig(this.deps.root).repo}/zipball/${encodeURIComponent(this.s.branch)}`
      const res = await request(this.deps.fetchFn, url, { headers: { Authorization: `Bearer ${this.deps.getToken()}`, Accept: 'application/vnd.github+json' } }, 'GitHub download')
      const zip = join(work, 'update.zip')
      await fs.writeFile(zip, Buffer.from(await res.arrayBuffer()))
      const out = join(work, 'files')
      await fs.mkdir(out)
      await this.deps.unzip(zip, out)
      // GitHub wraps everything in one "owner-repo-sha" folder.
      const top = (await fs.readdir(out, { withFileTypes: true })).filter((e) => e.isDirectory())
      const src = top.length === 1 ? join(out, top[0].name) : out
      if (!existsSync(join(src, 'package.json'))) throw new Error('The download did not look like Vanity.')
      for (const e of await fs.readdir(src)) {
        if (KEEP.has(e) || /^\.env\..*local$/.test(e)) continue
        await fs.cp(join(src, e), join(this.deps.root, e), { recursive: true, force: true })
      }
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {})
    }
  }
}

function describe(err: unknown): string {
  if (err instanceof NetworkError) return "Couldn't reach GitHub. Check your internet connection."
  if (err instanceof HttpError && (err.status === 401 || err.status === 403)) return 'GitHub rejected the token. Check it in Settings → Updates.'
  if (err instanceof HttpError && err.status === 404) return "GitHub couldn't find the repo or branch. The token may not have access to it."
  const msg = err instanceof Error ? err.message : String(err)
  if (/could not read Username|Authentication failed|terminal prompts disabled/i.test(msg)) return 'Git needs your GitHub login. Run "git pull" once in the Vanity folder to sign in.'
  return msg.trim().split('\n').slice(-3).join(' ').slice(0, 400)
}

