import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>

const N = 16384
const R = 8
const P = 1
const KEY_LEN = 64

/** scrypt hash, stored as "scrypt$N$r$p$salt$hash" (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 })
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

export interface TokenClaims {
  sub: string
  username: string
  iat: number
  exp: number
}

const b64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url')

/** A signed session token (JWT, HS256). */
export function signToken(claims: Omit<TokenClaims, 'iat' | 'exp'>, secret: string, ttlSeconds: number, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ ...claims, iat, exp: iat + ttlSeconds }))
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

/** The token's claims if the signature is valid and it hasn't expired; otherwise null. */
export function verifyToken(token: string, secret: string, nowMs = Date.now()): TokenClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, sig] = parts
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest()
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: string }
    if (h.alg !== 'HS256') return null
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as TokenClaims
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs) return null
    return claims
  } catch {
    return null
  }
}
