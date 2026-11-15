// GOG: sign-in, the list of games you own, and downloading their offline installers.
//
// GOG has no official public API for this. These are the same endpoints GOG's own website and
// GOG Galaxy use, as documented by the community (lgogdownloader, Heroic). They work today, but
// GOG can change them without notice. The client id and secret below are GOG Galaxy's own, the
// same for everyone and published in every open-source GOG tool: they identify "a Galaxy-like
// client", not Vanity or any user, so they are not secrets that need protecting.

import { createWriteStream, promises as fs } from 'node:fs'
import { basename } from 'node:path'

const CLIENT_ID = '46899977096215655'
const CLIENT_SECRET = '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9'
const REDIRECT = 'https://embed.gog.com/on_login_success?origin=client'

export const GOG_AUTH_URL = `https://auth.gog.com/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&layout=client2`

/** The one-time code from the address GOG sends the browser to after signing in, or null. */
export function gogCodeFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname !== 'embed.gog.com' || u.pathname !== '/on_login_success') return null
    return u.searchParams.get('code')
  } catch {
    return null
  }
}

export interface GogTokens {
  accessToken: string
  refreshToken: string
  /** When the access token stops working (ms). */
  expiresAt: number
}

/** Where the GOG sign-in is kept: encrypted with the OS credential protection, like the Vanity session. */
export interface GogVault {
  load(): Promise<GogTokens | null>
  save(tokens: GogTokens | null): Promise<void>
}

export interface GogGame {
  id: string
  title: string
  coverUrl: string | null
}

export interface GogInstallerFile {
  id: string
  size: number
  /** An api.gog.com address that answers with the real download address. */
  downlink: string
}

export interface GogInstaller {
  name: string
  language: string
  totalBytes: number
  files: GogInstallerFile[]
}

export class GogError extends Error {
  constructor(
    message: string,
    /** The sign-in is no longer valid. */
    readonly signedOut = false
  ) {
    super(message)
  }
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export interface GogDeps {
  fetchFn: FetchFn
  vault: GogVault
  now?: () => number
}

const OFFLINE = "Couldn't reach GOG. Check your internet connection and try again."

export class Gog {
  private tokens: GogTokens | null | undefined

  constructor(private deps: GogDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private async saved(): Promise<GogTokens | null> {
    if (this.tokens === undefined) this.tokens = await this.deps.vault.load().catch(() => null)
    return this.tokens
  }

  async signedIn(): Promise<boolean> {
    return !!(await this.saved())
  }

  private async tokenRequest(params: Record<string, string>): Promise<GogTokens> {
    const query = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params })
    let res: Response
    try {
      res = await this.deps.fetchFn(`https://auth.gog.com/token?${query}`, { signal: AbortSignal.timeout(20_000) })
    } catch {
      throw new GogError(OFFLINE)
    }
    const data = (await res.json().catch(() => null)) as { access_token?: string; refresh_token?: string; expires_in?: number } | null
    if (!res.ok || !data?.access_token || !data.refresh_token) throw new GogError('GOG sign-in failed. Try again.', res.status === 400 || res.status === 401)
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: this.now() + (Number(data.expires_in) || 3600) * 1000 }
  }

  /** Finishes signing in with the one-time code from GOG's sign-in page. */
  async login(code: string): Promise<void> {
    this.tokens = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT })
    await this.deps.vault.save(this.tokens)
  }

  async logout(): Promise<void> {
    this.tokens = null
    await this.deps.vault.save(null)
  }

  /** A working access token, refreshed when it is about to run out. */
  private async token(): Promise<string> {
    const t = await this.saved()
    if (!t) throw new GogError('Sign in to GOG first (Account → Linked accounts).', true)
    if (t.expiresAt - 60_000 > this.now()) return t.accessToken
    try {
      this.tokens = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken })
    } catch (err) {
      if (err instanceof GogError && err.signedOut) {
        await this.logout()
        throw new GogError('Your GOG sign-in has expired. Sign in to GOG again (Account → Linked accounts).', true)
      }
      throw err
    }
    await this.deps.vault.save(this.tokens)
    return this.tokens.accessToken
  }

  private async api<T>(url: string): Promise<T> {
    const token = await this.token()
    let res: Response
    try {
      res = await this.deps.fetchFn(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
    } catch {
      throw new GogError(OFFLINE)
    }
    if (res.status === 401) {
      await this.logout()
      throw new GogError('Your GOG sign-in has expired. Sign in to GOG again (Account → Linked accounts).', true)
    }
    if (!res.ok) throw new GogError(`GOG answered with an error (${res.status}). Try again in a moment.`)
    try {
      return (await res.json()) as T
    } catch {
      throw new GogError("GOG's answer couldn't be read. Try again in a moment.")
    }
  }

  /** The GOG username, or null when not signed in. */
  async account(): Promise<string | null> {
    if (!(await this.signedIn())) return null
    const data = await this.api<{ username?: string; isLoggedIn?: boolean }>('https://embed.gog.com/userData.json')
    return data.username ?? null
  }

  /** Every game on the account that runs on Windows. */
  async games(): Promise<GogGame[]> {
    const out: GogGame[] = []
    for (let page = 1; page <= 200; page++) {
      const data = await this.api<{ totalPages?: number; products?: { id?: number; title?: string; image?: string; isGame?: boolean; worksOn?: { Windows?: boolean } }[] }>(
        `https://embed.gog.com/account/getFilteredProducts?mediaType=1&page=${page}`
      )
      for (const p of data.products ?? []) {
        if (!p.id || !p.title || p.isGame === false || p.worksOn?.Windows === false) continue
        const image = p.image ? `${p.image.startsWith('//') ? 'https:' : ''}${p.image}_392.jpg` : null
        out.push({ id: String(p.id), title: p.title.trim(), coverUrl: image })
      }
      if (page >= (data.totalPages ?? 1)) break
    }
    return out
  }

  /** The Windows installer for a game (English if there is one). */
  async installer(id: string): Promise<GogInstaller> {
    if (!/^\d+$/.test(id)) throw new GogError("That isn't a GOG game.")
    const data = await this.api<{ downloads?: { installers?: { name?: string; os?: string; language?: string; total_size?: number; files?: { id?: string; size?: number; downlink?: string }[] }[] } }>(
      `https://api.gog.com/products/${id}?expand=downloads`
    )
    const windows = (data.downloads?.installers ?? []).filter((i) => i.os === 'windows' && i.files?.length)
    const chosen = windows.find((i) => i.language === 'en') ?? windows[0]
    if (!chosen) throw new GogError("GOG doesn't offer a Windows installer for this game.")
    const files = chosen.files!.filter((f) => f.id && f.downlink && /^https:\/\/api\.gog\.com\//.test(f.downlink!)).map((f) => ({ id: f.id!, size: Number(f.size) || 0, downlink: f.downlink! }))
    if (!files.length) throw new GogError("GOG doesn't offer a Windows installer for this game.")
    return { name: chosen.name ?? 'Installer', language: chosen.language ?? 'en', totalBytes: Number(chosen.total_size) || files.reduce((n, f) => n + f.size, 0), files }
  }

  /** The real (signed, short-lived) download address of an installer file, and the name to save it under. */
  async resolve(file: GogInstallerFile): Promise<{ url: string; filename: string }> {
    const data = await this.api<{ downlink?: string }>(file.downlink)
    if (!data.downlink || !/^https:\/\//.test(data.downlink)) throw new GogError("GOG didn't give a download address. Try again in a moment.")
    const name = decodeURIComponent(basename(new URL(data.downlink).pathname)).replace(/[^\w.()\- ]/g, '_')
    return { url: data.downlink, filename: name || `${file.id}.bin` }
  }

  /**
   * Downloads one file, continuing a partial one where it stopped.
   * `onBytes` is called with the total number of bytes on disk so far.
   */
  async download(url: string, dest: string, opts: { signal: AbortSignal; onBytes(total: number): void; expectedSize?: number }): Promise<void> {
    let have = 0
    try {
      have = (await fs.stat(dest)).size
    } catch {
      have = 0
    }
    if (opts.expectedSize && have === opts.expectedSize) {
      opts.onBytes(have)
      return
    }
    let res: Response
    try {
      res = await this.deps.fetchFn(url, { headers: have > 0 ? { range: `bytes=${have}-` } : {}, signal: opts.signal })
    } catch (err) {
      if (opts.signal.aborted) throw err
      throw new GogError(OFFLINE)
    }
    if (res.status === 416) {
      // Asked to continue past the end: the file on disk is already complete.
      opts.onBytes(have)
      return
    }
    if (!res.ok || !res.body) throw new GogError(`The download failed (error ${res.status}). Try again.`)
    const append = res.status === 206 && have > 0
    if (!append) have = 0
    const out = createWriteStream(dest, { flags: append ? 'a' : 'w' })
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
        have += value.byteLength
        opts.onBytes(have)
      }
    } catch (err) {
      if (opts.signal.aborted) throw err
      throw new GogError('The download was interrupted. Resume to carry on where it stopped.')
    } finally {
      await new Promise<void>((r) => out.end(() => r()))
    }
    if (opts.expectedSize && have !== opts.expectedSize) throw new GogError('The download ended early. Resume to carry on where it stopped.')
  }
}

/**
 * The command that runs a GOG installer without its windows, into `targetDir`.
 * GOG installers are Inno Setup programs; Windows shows its usual "allow this app" prompt.
 */
export function gogInstallCommand(installerExe: string, targetDir: string): { file: string; args: string[] } {
  const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`
  const innoArgs = ['/VERYSILENT', '/SP-', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOCANCEL', '/LANG=english', `/DIR="${targetDir}"`]
  const script =
    `$p = Start-Process -FilePath ${quote(installerExe)} -ArgumentList ${innoArgs.map(quote).join(', ')} -Verb RunAs -Wait -PassThru; ` +
    'if ($null -eq $p) { exit 1 } else { exit $p.ExitCode }'
  return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script] }
}
