// Downloads the Legendary program (the open-source Epic Games client Vanity uses to install Epic
// games) into resources/bin, so it ships inside the installer. Run by the release workflow and by
// `npm run dist:win`.
//
// The exact file is pinned: a specific release, checked against its SHA-256, so a build can never
// pick up something else. To move to a newer Legendary, change VERSION and SHA256 together.
// Legendary is GPL-3.0; its licence and source link are in resources/bin/LEGENDARY-LICENSE.txt.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '0.20.34'
const SHA256 = '01ea22ea51749f46a0019657f64fc0d34429fb7cbf9b590c0848c0e0bd9c1f07'
const URL = `https://github.com/derrod/legendary/releases/download/${VERSION}/legendary.exe`

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'resources', 'bin', 'legendary.exe')
const sha = (buf) => createHash('sha256').update(buf).digest('hex')

if (existsSync(dest) && sha(readFileSync(dest)) === SHA256) {
  console.log(`Legendary ${VERSION} is already in resources/bin.`)
  process.exit(0)
}

console.log(`Downloading Legendary ${VERSION}…`)
const res = await fetch(URL, { redirect: 'follow' })
if (!res.ok) {
  console.error(`Could not download ${URL}: HTTP ${res.status}`)
  process.exit(1)
}
const body = Buffer.from(await res.arrayBuffer())
const got = sha(body)
if (got !== SHA256) {
  console.error(`The downloaded file is not the expected one.\n  expected ${SHA256}\n  got      ${got}\nNothing was saved.`)
  process.exit(1)
}
mkdirSync(dirname(dest), { recursive: true })
writeFileSync(dest, body)
console.log(`Saved resources/bin/legendary.exe (${(body.length / 1024 / 1024).toFixed(1)} MB, checksum OK).`)
