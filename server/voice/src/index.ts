// Starts the Vanity voice signaling server. Run with `npm run dev` (from source) or
// `npm run build && npm start`. Settings come from the environment or a .env file (see .env.example).
import { existsSync, readFileSync } from 'node:fs'
import { vanityVerifier } from './auth'
import { configFromEnv } from './config'
import { iceServersFor } from './ice'
import { createVoiceServer } from './server'

// A small .env reader, so nothing else needs installing. Real environment variables win.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !line.trimStart().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

let config
try {
  config = configFromEnv()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}

const server = createVoiceServer({
  verify: config.vanityApiUrl ? vanityVerifier(config.vanityApiUrl) : async () => null,
  allowGuests: config.allowGuests,
  iceServers: (user) => iceServersFor(config.ice, user.id),
  log: (line) => console.log(`[voice] ${line}`)
})

server.http.listen(config.port, config.host, () => {
  console.log(`Vanity voice server on ws://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`)
  console.log(`  accounts: ${config.vanityApiUrl || 'off'}${config.allowGuests ? ' (guests allowed)' : ''}`)
  console.log(`  STUN: ${config.ice.stun.length ? config.ice.stun.join(', ') : 'none'}`)
  console.log(`  TURN: ${config.ice.turn.length ? `${config.ice.turn.join(', ')} (${config.ice.turnSecret ? 'short-lived logins from TURN_SECRET' : config.ice.turnUsername ? 'fixed login' : 'NO LOGIN SET: it will not work'})` : 'none (players on strict networks may not connect)'}`)
})

const stop = (): void => {
  console.log('Stopping…')
  void server.close().then(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
