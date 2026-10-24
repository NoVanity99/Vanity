import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Sql } from '../src/db'
import type { UpdateBundle } from '../src/updates'
// @ts-expect-error plain JS build helper
import { zip } from '../scripts/zip.mjs'

const SECRET = 'test-secret-that-is-at-least-32-characters-long'
const noSql = (async () => []) as unknown as Sql

describe('zip writer', () => {
  it('writes archives that standard tools read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vanity-zip-'))
    const file = join(dir, 'a.zip')
    writeFileSync(file, zip([{ name: 'a/b.txt', data: Buffer.from('hello '.repeat(200)) }, { name: 'c.bin', data: Buffer.from([1, 2, 3]) }]))
    expect(execFileSync('unzip', ['-t', file], { encoding: 'utf8' })).toMatch(/No errors/)
    expect(execFileSync('unzip', ['-p', file, 'a/b.txt'], { encoding: 'utf8' })).toBe('hello '.repeat(200))
  })
})

describe('update bundle build', () => {
  it('packs the app (not dependencies, secrets or itself)', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'vanity-bundle-')), 'bundle.ts')
    execFileSync('node', [join(__dirname, '..', 'scripts', 'build-update-bundle.mjs'), '--out', out])
    const bundle = JSON.parse(/= (\{.*\})\n/.exec(readFileSync(out, 'utf8'))![1]) as UpdateBundle
    const appPkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'))
    expect(bundle.version).toBe(appPkg.version)
    expect(bundle.changelog).toMatch(/## \d+\.\d+\.\d+/)
    const zipFile = join(tmpdir(), `vanity-bundle-${Date.now()}.zip`)
    writeFileSync(zipFile, Buffer.from(bundle.zipBase64, 'base64'))
    const names = execFileSync('unzip', ['-Z1', zipFile], { encoding: 'utf8', maxBuffer: 50e6 }).split('\n').filter(Boolean)
    expect(names).toContain('package.json')
    expect(names).toContain('src/main/index.ts')
    expect(names).toContain('server/src/app.ts')
    expect(names.some((n) => n.includes('node_modules/'))).toBe(false)
    expect(names.some((n) => /(^|\/)\.env(\.|$)/.test(n) && !n.endsWith('.env.example'))).toBe(false)
    expect(names.some((n) => n.startsWith('server/src/generated/'))).toBe(false)
    expect(names.some((n) => n.startsWith('out/') || n.startsWith('.git/'))).toBe(false)
  }, 60_000)
})

describe('update routes', () => {
  const bundle: UpdateBundle = { version: '9.9.9', changelog: '## 9.9.9\n- New', sha: 'abc', builtAt: 1, size: 3, zipBase64: Buffer.from('ZIP').toString('base64') }

  it('serves the manifest and the zip, at / and /api', async () => {
    const app = createApp({ sql: noSql, jwtSecret: SECRET, updates: async () => bundle })
    for (const prefix of ['', '/api']) {
      const manifest = await app.request(`${prefix}/update`)
      expect(manifest.status).toBe(200)
      expect(await manifest.json()).toEqual({ version: '9.9.9', changelog: '## 9.9.9\n- New', sha: 'abc', builtAt: 1, size: 3 })
      const dl = await app.request(`${prefix}/update/download`)
      expect(dl.headers.get('content-type')).toBe('application/zip')
      expect(Buffer.from(await dl.arrayBuffer()).toString()).toBe('ZIP')
    }
  })

  it('needs the update key when one is set', async () => {
    const app = createApp({ sql: noSql, jwtSecret: SECRET, updates: async () => bundle, updateKey: 'sesame' })
    expect((await app.request('/update')).status).toBe(401)
    expect((await app.request('/update', { headers: { 'x-update-key': 'wrong' } })).status).toBe(401)
    expect((await app.request('/update', { headers: { 'x-update-key': 'sesame' } })).status).toBe(200)
  })

  it('says when this deployment has no bundle', async () => {
    const res = await createApp({ sql: noSql, jwtSecret: SECRET, updates: async () => null }).request('/update')
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toMatch(/no update bundle/)
  })
})
