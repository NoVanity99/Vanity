import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/types'
import { compareVersions, notesSince, parseChangelog } from '../changelog'
import { exec, unzip } from '../exec'
import { UpdateService, type UpdateDeps } from '../service'

const CHANGELOG = `# Changelog

## 0.3.0 (2026-11-01)
- New thing
- Fixed a bug that
  wrapped onto two lines

## 0.2.0 - 2026-10-24
- Update button

## 0.1.0
- First version
`

describe('changelog', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0)
  })

  it('parses entries and picks the ones newer than yours', () => {
    const notes = parseChangelog(CHANGELOG)
    expect(notes.map((n) => [n.version, n.date])).toEqual([
      ['0.3.0', '2026-11-01'],
      ['0.2.0', '2026-10-24'],
      ['0.1.0', null]
    ])
    expect(notes[0].changes).toEqual(['New thing', 'Fixed a bug that wrapped onto two lines'])
    expect(notesSince(notes, '0.1.0', '0.3.0').map((n) => n.version)).toEqual(['0.3.0', '0.2.0'])
    expect(notesSince(notes, '0.1.0', '0.2.0').map((n) => n.version)).toEqual(['0.2.0'])
  })
})

const pkg = (version: string, branch = 'main'): string => JSON.stringify({ name: 'vanity', version, vanity: { repo: 'me/vanity', updateBranch: branch } }, null, 2)
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })

function service(root: string, over: Partial<UpdateDeps> = {}) {
  const states: UpdateState[] = []
  const restart = vi.fn()
  const calls: string[] = []
  const svc = new UpdateService({
    root,
    fetchFn: async () => new Response('nope', { status: 500 }),
    serverUrl: () => '',
    getUpdateKey: () => '',
    getToken: () => '',
    exec: (cmd, args, opts) => {
      calls.push(`${cmd} ${args.join(' ')}`)
      // npm and the build are faked; git is real.
      return cmd === 'git' ? exec(cmd, args, opts) : Promise.resolve('')
    },
    unzip,
    tmpDir: mkdtempSync(join(tmpdir(), 'vanity-tmp-')),
    isDev: false,
    supported: true,
    onUpdate: (s) => states.push(s),
    restart,
    ...over
  })
  return { svc, states, restart, calls }
}

describe('UpdateService (git clone)', () => {
  it('finds a pushed update with patch notes, applies it and restarts', async () => {
    const base = mkdtempSync(join(tmpdir(), 'vanity-git-'))
    const origin = join(base, 'origin')
    git(base, 'init', '-q', '-b', 'main', origin)
    writeFileSync(join(origin, 'package.json'), pkg('0.1.0'))
    writeFileSync(join(origin, 'package-lock.json'), '{"v":1}')
    writeFileSync(join(origin, 'CHANGELOG.md'), '## 0.1.0\n- First version\n')
    git(origin, 'add', '.')
    git(origin, 'commit', '-q', '-m', 'first')
    const clone = join(base, 'clone')
    git(base, 'clone', '-q', origin, clone)

    const { svc, restart, calls } = service(clone)
    await (svc as unknown as { init(): Promise<void> }).init()
    expect(svc.state()).toMatchObject({ mode: 'git', branch: 'main' })
    expect(await svc.check()).toMatchObject({ available: false, current: '0.1.0', error: null })

    writeFileSync(join(origin, 'package.json'), pkg('0.3.0'))
    writeFileSync(join(origin, 'package-lock.json'), '{"v":2}')
    writeFileSync(join(origin, 'CHANGELOG.md'), CHANGELOG)
    git(origin, 'commit', '-q', '-am', 'Release 0.3.0')

    const found = await svc.check()
    expect(found).toMatchObject({ available: true, latest: '0.3.0' })
    expect(found.notes.map((n) => n.version)).toEqual(['0.3.0', '0.2.0'])

    // A lockfile rewritten locally by npm doesn't block the update.
    writeFileSync(join(clone, 'package-lock.json'), '{"v":"local"}')
    await svc.apply()
    expect(JSON.parse(readFileSync(join(clone, 'package.json'), 'utf8')).version).toBe('0.3.0')
    expect(calls).toContain('npm install --no-audit --no-fund') // the lockfile changed
    expect(calls).toContain('npx electron-vite build')
    expect(restart).toHaveBeenCalledOnce()
  })

  it('falls back to commit titles without a changelog, and skips the build in dev', async () => {
    const base = mkdtempSync(join(tmpdir(), 'vanity-git-'))
    const origin = join(base, 'origin')
    git(base, 'init', '-q', '-b', 'main', origin)
    writeFileSync(join(origin, 'package.json'), pkg('0.1.0'))
    git(origin, 'add', '.')
    git(origin, 'commit', '-q', '-m', 'first')
    const clone = join(base, 'clone')
    git(base, 'clone', '-q', origin, clone)
    writeFileSync(join(origin, 'a.txt'), 'x')
    git(origin, 'add', '.')
    git(origin, 'commit', '-q', '-m', 'Make the player nicer')

    const { svc, restart, calls } = service(clone, { isDev: true })
    await (svc as unknown as { init(): Promise<void> }).init()
    const found = await svc.check()
    expect(found.notes).toEqual([{ version: '0.1.0', date: null, changes: ['Make the player nicer'] }])
    await svc.apply()
    expect(existsSync(join(clone, 'a.txt'))).toBe(true)
    expect(calls.some((c) => c.startsWith('npm') || c.startsWith('npx'))).toBe(false)
    expect(restart).toHaveBeenCalledOnce()
  })
})

describe('UpdateService (download with a token)', () => {
  it('asks for a token, then checks the API and installs the zip, keeping your keys', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vanity-dl-'))
    writeFileSync(join(root, 'package.json'), pkg('0.1.0', 'dev'))
    writeFileSync(join(root, '.env.local'), 'MINE=1')

    // What GitHub would serve: a zip with one wrapping folder.
    const src = mkdtempSync(join(tmpdir(), 'vanity-src-'))
    const top = join(src, 'me-vanity-abc123')
    execFileSync('mkdir', ['-p', join(top, 'src')])
    writeFileSync(join(top, 'package.json'), pkg('0.2.0', 'dev'))
    writeFileSync(join(top, 'CHANGELOG.md'), CHANGELOG)
    writeFileSync(join(top, 'src', 'new.ts'), 'export {}')
    writeFileSync(join(top, '.env.local'), 'THEIRS=1')
    execFileSync('zip', ['-qr', join(src, 'z.zip'), 'me-vanity-abc123'], { cwd: src })
    const zip = readFileSync(join(src, 'z.zip'))

    let token = ''
    const seen: { url: string; auth: string | null }[] = []
    const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers)
      seen.push({ url, auth: headers.get('authorization') })
      if (url.includes('/contents/package.json?ref=dev')) {
        if (headers.get('if-none-match') === '"v2"') return new Response(null, { status: 304 })
        return new Response(pkg('0.2.0', 'dev'), { headers: { etag: '"v2"' } })
      }
      if (url.includes('/contents/CHANGELOG.md')) return new Response(CHANGELOG)
      if (url.endsWith('/zipball/dev')) return new Response(zip)
      return new Response('?', { status: 404 })
    }
    const { svc, restart } = service(root, { fetchFn, getToken: () => token })
    expect(svc.state().mode).toBe('github')
    expect(await svc.check()).toMatchObject({ needsToken: true, available: false })

    token = 'ghp_test'
    const found = await svc.check()
    expect(found).toMatchObject({ needsToken: false, available: true, latest: '0.2.0' })
    expect(found.notes.map((n) => n.version)).toEqual(['0.2.0']) // 0.3.0 is newer than what's on GitHub
    expect(seen.at(-1)?.auth).toBe('Bearer ghp_test')
    await svc.check() // served from the ETag cache (304)

    await svc.apply()
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('0.2.0')
    expect(existsSync(join(root, 'src', 'new.ts'))).toBe(true)
    expect(readFileSync(join(root, '.env.local'), 'utf8')).toBe('MINE=1')
    expect(restart).toHaveBeenCalledOnce()
  })

  it('reports a rejected token', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vanity-dl-'))
    writeFileSync(join(root, 'package.json'), pkg('0.1.0'))
    const { svc } = service(root, { getToken: () => 'bad', fetchFn: async () => new Response('', { status: 401 }) })
    expect((await svc.check()).error).toMatch(/rejected the token/)
    await expect(svc.apply()).rejects.toThrow(/no update/)
  })

  it('does nothing for installed builds', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vanity-dl-'))
    writeFileSync(join(root, 'package.json'), pkg('0.1.0'))
    const { svc, states } = service(root, { supported: false })
    expect(await svc.check()).toMatchObject({ mode: 'unsupported', available: false })
    expect(states).toEqual([])
  })
})

describe('UpdateService (Vercel server)', () => {
  function serverZip(version: string): Buffer {
    // The Vercel bundle has the files at the top level (no wrapping folder).
    const src = mkdtempSync(join(tmpdir(), 'vanity-vsrc-'))
    execFileSync('mkdir', ['-p', join(src, 'src')])
    writeFileSync(join(src, 'package.json'), pkg(version))
    writeFileSync(join(src, 'src', 'feature.ts'), 'export {}')
    execFileSync('zip', ['-qr', join(src, 'b.zip'), 'package.json', 'src'], { cwd: src })
    return readFileSync(join(src, 'b.zip'))
  }

  it('checks the server, shows its patch notes, installs its bundle, and wins over git', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vanity-v-'))
    writeFileSync(join(root, 'package.json'), pkg('0.1.0'))
    execFileSync('mkdir', [join(root, '.git')]) // looks like a clone: Vercel is still used
    const zipData = serverZip('0.3.0')
    const seen: { url: string; key: string | null }[] = []
    const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
      seen.push({ url, key: new Headers(init?.headers).get('x-update-key') })
      if (url === 'https://vanity.vercel.app/api/update') return Response.json({ version: '0.3.0', changelog: CHANGELOG })
      if (url === 'https://vanity.vercel.app/api/update/download') return new Response(zipData)
      return new Response('?', { status: 404 })
    }
    const { svc, restart } = service(root, { fetchFn, serverUrl: () => 'https://vanity.vercel.app/api', getUpdateKey: () => 'k1' })
    const found = await svc.check()
    expect(found).toMatchObject({ mode: 'vercel', source: 'https://vanity.vercel.app/api', available: true, latest: '0.3.0' })
    expect(found.notes.map((n) => n.version)).toEqual(['0.3.0', '0.2.0'])
    expect(seen[0].key).toBe('k1')

    await svc.apply()
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('0.3.0')
    expect(existsSync(join(root, 'src', 'feature.ts'))).toBe(true)
    expect(restart).toHaveBeenCalledOnce()
  })

  it('explains a missing key or bundle, and falls back to GitHub without a server', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vanity-v-'))
    writeFileSync(join(root, 'package.json'), pkg('0.1.0'))
    let status = 401
    let url = 'https://vanity.vercel.app/api'
    const { svc } = service(root, { fetchFn: async () => new Response('{}', { status }), serverUrl: () => url })
    expect((await svc.check()).error).toMatch(/update key/)
    status = 404
    expect((await svc.check()).error).toMatch(/no update bundle/)
    url = ''
    expect(await svc.check()).toMatchObject({ mode: 'github', needsToken: true, error: null })
  })
})
