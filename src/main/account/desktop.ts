import { normalizeProfileStyle } from '../../shared/profileStyle'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import type { AuthHttp } from './neonAuth'
import type { SavedSession, SessionVault } from './service'

/**
 * Requests to Neon Auth. Node's own fetch is used (not Chromium's) because it lets the app set
 * the Cookie and Origin headers itself, and keeps nothing in a browser cookie store.
 */
export const nodeAuthHttp: AuthHttp = async ({ url, method, headers, body }) => {
  const res = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15_000) })
  const out: Record<string, string> = {}
  res.headers.forEach((value, name) => (out[name.toLowerCase()] = value))
  return { status: res.status, headers: out, setCookie: res.headers.getSetCookie(), body: await res.text() }
}

/**
 * The saved session, encrypted with the operating system's credential protection
 * (DPAPI on Windows: only this Windows user on this PC can read it).
 * If that protection isn't available the session is simply not saved: never in plain text.
 */
export function createSessionVault(file: string): SessionVault {
  return {
    async load() {
      let data: Buffer
      try {
        data = await fs.readFile(file)
      } catch {
        return null
      }
      if (!safeStorage.isEncryptionAvailable()) return null
      try {
        const parsed = JSON.parse(safeStorage.decryptString(data)) as Partial<SavedSession>
        if (typeof parsed.cookie !== 'string' || typeof parsed.userId !== 'string') return null
        return {
          cookie: parsed.cookie,
          userId: parsed.userId,
          email: String(parsed.email ?? ''),
          username: typeof parsed.username === 'string' ? parsed.username : null,
          avatar: typeof parsed.avatar === 'string' ? parsed.avatar : null,
          bio: typeof parsed.bio === 'string' ? parsed.bio : '',
          style: normalizeProfileStyle(parsed.style),
          verified: parsed.verified === true,
          admin: parsed.admin === true
        }
      } catch {
        // E.g. copied from another PC or Windows account: it can't be read there, by design.
        return null
      }
    },
    async save(session) {
      if (!session || !safeStorage.isEncryptionAvailable()) {
        await fs.rm(file, { force: true })
        return !session
      }
      await fs.mkdir(dirname(file), { recursive: true })
      await fs.writeFile(`${file}.tmp`, safeStorage.encryptString(JSON.stringify(session)))
      await fs.rename(`${file}.tmp`, file)
      return true
    }
  }
}
