import { DEFAULT_STUN, type IceConfig } from './ice'

/** Everything the server reads from its environment (a .env file next to it, or the host's settings). See .env.example. */
export interface ServerConfig {
  port: number
  host: string
  /** The Vanity account server, which says who a sign-in token belongs to. */
  vanityApiUrl: string
  /** Let people in without an account, by name. Only for trying the server out. */
  allowGuests: boolean
  ice: IceConfig
}

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const vanityApiUrl = (env.VANITY_API_URL ?? '').trim()
  const allowGuests = /^(1|true|yes)$/i.test(env.ALLOW_GUESTS ?? '')
  if (!vanityApiUrl && !allowGuests) {
    throw new Error('Set VANITY_API_URL (your Vanity account server) in .env, or ALLOW_GUESTS=true to try the server without accounts. See .env.example.')
  }
  return {
    port: Number(env.PORT) || 8787,
    host: env.HOST || '0.0.0.0',
    vanityApiUrl,
    allowGuests,
    ice: {
      stun: env.STUN_URLS === undefined ? DEFAULT_STUN : list(env.STUN_URLS),
      turn: list(env.TURN_URLS),
      turnSecret: env.TURN_SECRET ?? '',
      turnTtlSeconds: Number(env.TURN_TTL_SECONDS) || 6 * 3600,
      turnUsername: env.TURN_USERNAME ?? '',
      turnCredential: env.TURN_CREDENTIAL ?? ''
    }
  }
}
