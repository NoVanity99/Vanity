// Writes .env.local with your API keys, so they're built into Vanity.
// Usage: npm run setup-keys
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, '.env.local')

const FIELDS = [
  ['MAIN_VITE_IGDB_CLIENT_ID', 'Twitch client ID (for IGDB and Trending)'],
  ['MAIN_VITE_IGDB_CLIENT_SECRET', 'Twitch client secret'],
  ['MAIN_VITE_STEAMGRIDDB_API_KEY', 'SteamGridDB API key (optional, for artwork)'],
  ['MAIN_VITE_GITHUB_TOKEN', 'GitHub token (optional, for updates if you did not git clone)']
]

// Notepad often saves ".env.local" as ".env.local.txt", which Windows hides.
for (const wrong of ['.env.local.txt', 'env.local', '.env.local.env']) {
  if (existsSync(join(root, wrong)) && !existsSync(file)) {
    renameSync(join(root, wrong), file)
    console.log(`Renamed ${wrong} to .env.local.`)
  }
}

const current = {}
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m) current[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

// Queue input lines so each question gets the next one (also works with piped input).
const rl = createInterface({ input: process.stdin })
const lines = []
const waiting = []
let ended = false
rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)))
rl.on('close', () => {
  ended = true
  while (waiting.length) waiting.shift()('')
})
const ask = (prompt) => {
  process.stdout.write(prompt)
  if (lines.length) return Promise.resolve(lines.shift())
  if (ended) return Promise.resolve('')
  return new Promise((r) => waiting.push(r))
}

console.log('Press Enter to keep a value that is already set.\n')
for (const [key, label] of FIELDS) {
  const has = current[key] ? ' [already set]' : ''
  const answer = (await ask(`${label}${has}: `)).trim().replace(/^["']|["']$/g, '')
  if (answer) current[key] = answer
}
rl.close()

const body = FIELDS.map(([key]) => `${key}=${current[key] ?? ''}`).join('\n') + '\n'
writeFileSync(file, body)
const missing = FIELDS.slice(0, 2).filter(([key]) => !current[key])
console.log(`\nSaved ${file}`)
if (missing.length) console.log(`Still missing: ${missing.map(([k]) => k).join(', ')}. Trending and IGDB details need both Twitch values.`)
console.log('Restart "npm run dev" (or rebuild) for the keys to take effect.')
