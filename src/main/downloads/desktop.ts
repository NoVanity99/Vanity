// The Windows-app side of in-launcher installs: where the bundled Epic downloader lives, the
// sign-in windows for Epic and GOG, and the encrypted file that keeps the GOG sign-in.

import { execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, safeStorage, session } from 'electron'
import { killProcesses } from '../launcher/processes'
import { gogCodeFromUrl, GOG_AUTH_URL, type GogTokens, type GogVault } from './gog'

/** The Legendary program shipped with Vanity, or null if this build doesn't have it. */
export function legendaryBinary(): string | null {
  const name = process.platform === 'win32' ? 'legendary.exe' : 'legendary'
  const candidates = [
    // Installed copies: resources are unpacked next to the app archive.
    join(process.resourcesPath ?? '', 'app.asar.unpacked', 'resources', 'bin', name),
    // Running from source.
    join(app.getAppPath(), 'resources', 'bin', name)
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** Kills a process and everything it started. */
export async function killTree(pid: number): Promise<void> {
  await killProcesses([pid])
}

/** Runs a program to the end and resolves to its exit code (1 if it couldn't be started). */
export function runToEnd(file: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 2 * 60 * 60_000 }, (err) => {
      if (!err) resolve(0)
      else resolve(typeof err.code === 'number' ? err.code : 1)
    })
  })
}

/**
 * The GOG sign-in, encrypted with Windows credential protection (DPAPI): only this Windows
 * user on this PC can read it. Without that protection it is kept for this run only.
 */
export function createGogVault(file: string): GogVault {
  let memory: GogTokens | null = null
  return {
    async load() {
      if (!safeStorage.isEncryptionAvailable()) return memory
      try {
        const parsed = JSON.parse(safeStorage.decryptString(await fs.readFile(file))) as Partial<GogTokens>
        if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string') return null
        return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, expiresAt: Number(parsed.expiresAt) || 0 }
      } catch {
        return null
      }
    },
    async save(tokens) {
      memory = tokens
      if (!tokens || !safeStorage.isEncryptionAvailable()) {
        await fs.rm(file, { force: true })
        return
      }
      await fs.mkdir(dirname(file), { recursive: true })
      await fs.writeFile(`${file}.tmp`, safeStorage.encryptString(JSON.stringify(tokens)))
      await fs.rename(`${file}.tmp`, file)
    }
  }
}

interface LoginWindowOptions {
  title: string
  url: string
  parent: BrowserWindow | null
  /** A throwaway browser profile, so the store's cookies never mix with anything else in Vanity. */
  partition: string
  /** Called on every page the window reaches; resolve with the code when it is there. */
  findCode(win: BrowserWindow, url: string): Promise<string | null> | string | null
}

/** Opens a store's own sign-in page in a window. Resolves to the one-time code, or null if closed. */
function loginWindow({ title, url, parent, partition, findCode }: LoginWindowOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const ses = session.fromPartition(partition)
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      title,
      parent: parent ?? undefined,
      modal: false,
      autoHideMenuBar: true,
      backgroundColor: '#0b0d12',
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    win.removeMenu()
    let settled = false
    const finish = (code: string | null): void => {
      if (settled) return
      settled = true
      resolve(code)
      if (!win.isDestroyed()) win.close()
      // The sign-in itself is kept by the store's own token, not by this window's cookies.
      void ses.clearStorageData().catch(() => {})
    }
    const check = async (current: string): Promise<void> => {
      if (settled) return
      try {
        const code = await findCode(win, current)
        if (code) finish(code)
      } catch {
        // The page wasn't the one with the code: keep waiting.
      }
    }
    win.webContents.on('will-redirect', (_e, next) => void check(next))
    win.webContents.on('did-navigate', (_e, next) => void check(next))
    win.webContents.on('did-finish-load', () => void check(win.webContents.getURL()))
    // The sign-in page only: links that would open other windows are ignored.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('closed', () => finish(null))
    void win.loadURL(url).catch(() => finish(null))
  })
}

/**
 * Epic's sign-in. Legendary's own flow: Epic's page ends on a small JSON document that holds a
 * one-time "authorizationCode", which Legendary trades for its sign-in. Vanity never sees the password.
 */
export function epicLoginWindow(parent: BrowserWindow | null): Promise<string | null> {
  return loginWindow({
    title: 'Sign in to Epic Games',
    url: 'https://legendary.gl/epiclogin',
    parent,
    partition: 'vanity-epic-login',
    findCode: async (win, url) => {
      if (!/^https:\/\/www\.epicgames\.com\/id\/api\/redirect/.test(url)) return null
      const text: unknown = await win.webContents.executeJavaScript('document.body ? document.body.innerText : ""', true)
      const code = (JSON.parse(String(text)) as { authorizationCode?: unknown }).authorizationCode
      return typeof code === 'string' && code ? code : null
    }
  })
}

/** GOG's sign-in: it finishes by sending the window to an address that carries the one-time code. */
export function gogLoginWindow(parent: BrowserWindow | null): Promise<string | null> {
  return loginWindow({ title: 'Sign in to GOG', url: GOG_AUTH_URL, parent, partition: 'vanity-gog-login', findCode: (_win, url) => gogCodeFromUrl(url) })
}
