// Builds installer/Vanity-Installer.exe, the small web installer that always downloads the newest
// Vanity from GitHub Releases. It only needs rebuilding if installer/web-installer.nsi changes.
// Uses the NSIS that electron-builder downloads (run `npm run dist:win` once first), or a makensis on PATH.
// Usage: node scripts/build-web-installer.mjs [--base-url <url>] [--out <file>]
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const out = resolve(arg('--out') ?? join(root, 'installer', 'Vanity-Installer.exe'))

const cache =
  process.env.ELECTRON_BUILDER_CACHE ??
  (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache') : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'electron-builder') : join(homedir(), '.cache', 'electron-builder'))
const firstDir = (base) => (existsSync(base) ? readdirSync(base).map((d) => join(base, d)).find((d) => existsSync(d)) : undefined)
const find = (prefix) => firstDir(join(cache, readdirSync(cache).find((d) => d.startsWith(prefix)) ?? '-'))

let makensis = 'makensis'
const env = { ...process.env }
const args = ['-V2', `-DOUT_FILE=${out}`]
if (existsSync(cache)) {
  const nsis = find('nsis-3')
  const resources = find('nsis-resources')
  if (nsis) {
    makensis = process.platform === 'win32' ? join(nsis, 'Bin', 'makensis.exe') : join(nsis, process.platform === 'darwin' ? 'mac' : 'linux', 'makensis')
    env.NSISDIR = nsis
  }
  // The download plugin (INetC) ships with electron-builder's NSIS resources.
  if (resources) args.push(`-X!addplugindir /x86-unicode "${join(resources, 'plugins', 'x86-unicode')}"`)
}
if (arg('--base-url')) args.push(`-DBASE_URL=${arg('--base-url')}`)

execFileSync(makensis, [...args, 'web-installer.nsi'], { cwd: join(root, 'installer'), env, stdio: 'inherit' })
console.log(`Built ${out}`)
