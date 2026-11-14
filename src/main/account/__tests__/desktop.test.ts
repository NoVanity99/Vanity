import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stands in for the OS credential protection (DPAPI on Windows): reversible only through this object.
const os = vi.hoisted(() => ({ available: true, key: 0x5a }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => os.available,
    encryptString: (s: string) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ os.key)),
    decryptString: (b: Buffer) => {
      const text = Buffer.from(b.map((x) => x ^ os.key)).toString('utf8')
      if (!text.startsWith('{')) throw new Error('cannot decrypt')
      return text
    }
  }
}))

import { createSessionVault } from '../desktop'
import { jwtExpiry, mergeCookies } from '../neonAuth'

const session = { cookie: '__Secure-neon-auth.session_token=abc.def', userId: 'u1', email: 'a@example.com', username: 'alice' }
let file: string

beforeEach(() => {
  os.available = true
  os.key = 0x5a
  file = join(mkdtempSync(join(tmpdir(), 'vanity-vault-')), 'session.bin')
})

describe('session vault (desktop)', () => {
  it('keeps the session encrypted on disk and reads it back', async () => {
    const vault = createSessionVault(file)
    expect(await vault.load()).toBeNull()
    expect(await vault.save(session)).toBe(true)
    const raw = readFileSync(file, 'latin1')
    expect(raw).not.toContain('session_token')
    expect(raw).not.toContain('a@example.com')
    expect(await createSessionVault(file).load()).toEqual(session)
  })

  it('forgets the session when asked', async () => {
    const vault = createSessionVault(file)
    await vault.save(session)
    await vault.save(null)
    expect(existsSync(file)).toBe(false)
    expect(await vault.load()).toBeNull()
  })

  it('never writes plain text: without OS protection nothing is saved', async () => {
    os.available = false
    const vault = createSessionVault(file)
    expect(await vault.save(session)).toBe(false)
    expect(existsSync(file)).toBe(false)
  })

  it('treats a file from another PC or user, or a damaged one, as not signed in', async () => {
    const vault = createSessionVault(file)
    await vault.save(session)
    os.key = 0x11 // a different Windows account can't decrypt it
    expect(await vault.load()).toBeNull()
    os.key = 0x5a
    writeFileSync(file, 'garbage')
    expect(await vault.load()).toBeNull()
  })
})

describe('cookies and tokens', () => {
  it('keeps cookies like a browser: new values replace old ones, expired ones go', () => {
    let jar = mergeCookies('', ['a=1; Path=/; HttpOnly', 'b=2; Max-Age=600'])
    expect(jar).toBe('a=1; b=2')
    jar = mergeCookies(jar, ['a=3; Path=/', 'b=; Max-Age=0; Path=/'])
    expect(jar).toBe('a=3')
    // Values may contain "=" (base64 signatures do).
    expect(mergeCookies('', ['t=abc.def%3D=; Secure'])).toBe('t=abc.def%3D=')
  })

  it('reads when a token expires, and treats rubbish as already expired', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', exp: 1_800_000_000 })).toString('base64url')
    expect(jwtExpiry(`x.${payload}.y`)).toBe(1_800_000_000_000)
    expect(jwtExpiry('not-a-token')).toBe(0)
  })
})
