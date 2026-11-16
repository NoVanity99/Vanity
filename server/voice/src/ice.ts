import { createHmac } from 'node:crypto'
import type { VoiceIceServer } from '../../../src/shared/voiceProtocol'

export interface IceConfig {
  /** STUN servers: free, public, only help players find their own public address. */
  stun: string[]
  /** TURN servers: relay audio when two players can't connect directly (strict NATs, some office/school networks). */
  turn: string[]
  /**
   * coturn's "use-auth-secret" (or a hosted TURN service that works the same way): each player
   * gets their own login that runs out after `turnTtlSeconds`, made from this secret. The secret
   * itself never leaves this server.
   */
  turnSecret: string
  turnTtlSeconds: number
  /** Or a fixed login, for a TURN service that only gives you one. */
  turnUsername: string
  turnCredential: string
}

export const DEFAULT_STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478']

/** The ICE servers one player should use, with their own short-lived TURN login when a secret is set. */
export function iceServersFor(config: IceConfig, userId: string, nowMs = Date.now()): VoiceIceServer[] {
  const servers: VoiceIceServer[] = []
  if (config.stun.length) servers.push({ urls: config.stun })
  if (config.turn.length) {
    if (config.turnSecret) {
      // The format coturn expects: "<expiry unix time>:<anything>", signed with the shared secret.
      const username = `${Math.floor(nowMs / 1000) + config.turnTtlSeconds}:${userId.replace(/:/g, '_').slice(0, 64)}`
      const credential = createHmac('sha1', config.turnSecret).update(username).digest('base64')
      servers.push({ urls: config.turn, username, credential })
    } else if (config.turnUsername && config.turnCredential) {
      servers.push({ urls: config.turn, username: config.turnUsername, credential: config.turnCredential })
    }
  }
  return servers
}
