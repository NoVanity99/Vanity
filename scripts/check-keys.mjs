// Checks the API keys built into Vanity (src/main/builtinKeys.ts) against Twitch/IGDB and SteamGridDB.
// Prints a warning for any that fail but never fails the build. Used by the release workflow.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'src', 'main', 'builtinKeys.ts'), 'utf8')
const key = (name) => {
  const m = new RegExp(`${name}: unscramble\\('([^']*)'\\)`).exec(src)
  return m ? Buffer.from(m[1], 'base64').toString('utf8').split('').reverse().join('') : ''
}
const env = (name, fallback) => process.env[name]?.trim() || fallback
const igdbId = env('MAIN_VITE_IGDB_CLIENT_ID', key('igdbClientId'))
const igdbSecret = env('MAIN_VITE_IGDB_CLIENT_SECRET', key('igdbClientSecret'))
const steamGridDb = env('MAIN_VITE_STEAMGRIDDB_API_KEY', key('steamGridDbApiKey'))

const report = (ok, label, detail) => console.log(ok ? `✓ ${label}: ${detail}` : `::warning title=${label}::${detail}`)

try {
  const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(igdbId)}&client_secret=${encodeURIComponent(igdbSecret)}&grant_type=client_credentials`, { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) report(false, 'IGDB keys', `Twitch rejected the client ID/secret (HTTP ${res.status}). Trending and game details won't work until the keys in src/main/builtinKeys.ts are fixed.`)
  else {
    const games = await fetch('https://api.igdb.com/v4/games', { method: 'POST', headers: { 'Client-ID': igdbId, Authorization: `Bearer ${body.access_token}` }, body: 'fields name; limit 1;' })
    report(games.ok, 'IGDB keys', games.ok ? 'working' : `got a token but IGDB answered HTTP ${games.status}`)
  }
} catch (err) {
  report(false, 'IGDB keys', `couldn't check (${err.message})`)
}

try {
  const res = await fetch('https://www.steamgriddb.com/api/v2/search/autocomplete/portal', { headers: { Authorization: `Bearer ${steamGridDb}` } })
  report(res.ok, 'SteamGridDB key', res.ok ? 'working' : `rejected (HTTP ${res.status}). Artwork falls back to Steam's own images.`)
} catch (err) {
  report(false, 'SteamGridDB key', `couldn't check (${err.message})`)
}
