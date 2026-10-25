// Writes the CHANGELOG.md entry for the version in package.json to build-notes/release-notes.md,
// which becomes the GitHub Release text (and the patch notes Vanity shows before updating).
// Usage: node scripts/release-notes.mjs [version]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2] ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')

const lines = changelog.split(/\r?\n/)
const start = lines.findIndex((l) => new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}\\b`).test(l))
if (start < 0) {
  console.error(`CHANGELOG.md has no "## ${version}" entry. Add one before releasing.`)
  process.exit(1)
}
const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
const out = join(root, 'build-notes', 'release-notes.md')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${body}\n`)
console.log(`Release notes for ${version}:\n${body}`)
