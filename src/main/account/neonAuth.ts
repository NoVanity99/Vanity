// Sign-in with Neon Auth (a hosted Better Auth server). Vanity never handles passwords itself:
// they go straight to Neon Auth over https, which answers with a session.
//
// Neon Auth is built for browsers, where the session lives in a cookie. A desktop or phone app
// does what Neon's own server-side helper does: it keeps the session cookie itself (encrypted,
// in the OS credential store) and sends it back with an Origin that Neon Auth trusts.

import { AccountError } from './errors'

export const USERNAME_IN_USE = 'That username is already in use.'
/** One message for every failed sign-in, so nobody can learn which accounts exist. */
export const SIGN_IN_FAILED = 'Incorrect username/email or password.'
export const EMAIL_IN_USE = 'That email is already in use. Sign in instead, or use another email.'

export interface AuthRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
}

export interface AuthResponse {
  status: number
  /** Header names in lower case. */
  headers: Record<string, string>
  /** Every Set-Cookie header, one per entry. */
  setCookie: string[]
  body: string
}

/** Sends one request. Throws when the server can't be reached. */
export type AuthHttp = (req: AuthRequest) => Promise<AuthResponse>

export interface AuthUser {
  id: string
  email: string
  name: string
}

export interface AuthSession {
  /** The session cookies, as a Cookie header. This is the secret that keeps you signed in. */
  cookie: string
  user: AuthUser
  /** A short-lived token for the Vanity server, when the response carried one. */
  jwt: string | null
}

/** Friendly messages for Neon Auth's error codes. */
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: SIGN_IN_FAILED,
  INVALID_EMAIL: "That doesn't look like an email address.",
  INVALID_PASSWORD: SIGN_IN_FAILED,
  USER_ALREADY_EXISTS: EMAIL_IN_USE,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: EMAIL_IN_USE,
  PASSWORD_TOO_SHORT: 'Passwords need at least 8 characters.',
  PASSWORD_TOO_LONG: 'That password is too long.',
  EMAIL_NOT_VERIFIED: 'Check your email and confirm your address first, then sign in.',
  INVALID_OTP: 'That code is wrong. Check the email and try again.',
  OTP_EXPIRED: 'That code has expired. Ask for a new one.',
  TOO_MANY_ATTEMPTS: 'Too many wrong codes. Ask for a new one.',
  USER_NOT_FOUND: SIGN_IN_FAILED
}

export const OFFLINE_MESSAGE = "You're offline, or Vanity's account service can't be reached. Check your connection and try again."

/** Keeps cookies the way a browser would: newest value wins, expired ones are dropped. */
export function mergeCookies(current: string, setCookie: string[]): string {
  const jar = new Map<string, string>()
  for (const pair of current.split(/;\s*/)) {
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
  for (const header of setCookie) {
    const [pair, ...attrs] = header.split(';')
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    const expired = attrs.some((a) => /^\s*max-age\s*=\s*(0|-\d+)\s*$/i.test(a)) || value === ''
    if (expired) jar.delete(name)
    else jar.set(name, value)
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
}

/** When a token stops being valid (ms), read from the token itself. 0 if it can't be read. */
export function jwtExpiry(jwt: string): number {
  try {
    const payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const exp = (JSON.parse(atob(payload)) as { exp?: number }).exp
    return typeof exp === 'number' ? exp * 1000 : 0
  } catch {
    return 0
  }
}

export class NeonAuth {
  constructor(
    private baseUrl: string,
    private http: AuthHttp,
    private origin: string
  ) {}

  private async call(method: 'GET' | 'POST', path: string, opts: { body?: unknown; cookie?: string } = {}): Promise<AuthResponse & { json: Record<string, unknown> | null }> {
    if (!this.baseUrl) throw new AccountError('Accounts are not set up in this build of Vanity.')
    const headers: Record<string, string> = { origin: this.origin, accept: 'application/json' }
    if (opts.cookie) headers.cookie = opts.cookie
    // Neon Auth refuses a POST without a JSON body.
    const body = method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined
    if (body !== undefined) headers['content-type'] = 'application/json'
    let res: AuthResponse
    try {
      res = await this.http({ url: `${this.baseUrl}${path}`, method, headers, body })
    } catch {
      throw new AccountError(OFFLINE_MESSAGE, false, true)
    }
    let json: Record<string, unknown> | null = null
    try {
      const parsed: unknown = res.body ? JSON.parse(res.body) : null
      if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>
    } catch {
      // Not JSON (for example an error page from a proxy).
    }
    if (res.status >= 200 && res.status < 300) return { ...res, json }
    const code = typeof json?.code === 'string' ? json.code : ''
    if (res.status === 429) throw new AccountError('Too many attempts. Wait a minute and try again.', false, false, 'rate_limited')
    if (res.status >= 500) throw new AccountError("Vanity's account service is having trouble. Try again in a moment.", false, true)
    throw new AccountError(MESSAGES[code] ?? (typeof json?.message === 'string' && json.message ? json.message : `Sign-in failed (error ${res.status}).`), false, false, code || `http_${res.status}`)
  }

  private toSession(res: AuthResponse & { json: Record<string, unknown> | null }, previousCookie = ''): AuthSession | null {
    const u = res.json?.user as Partial<AuthUser> | undefined
    const cookie = mergeCookies(previousCookie, res.setCookie)
    if (!u || typeof u.id !== 'string' || !cookie) return null
    return { cookie, user: { id: u.id, email: String(u.email ?? ''), name: String(u.name ?? '') }, jwt: res.headers['set-auth-jwt'] || null }
  }

  /** Creates the account and signs in. `name` is shown in Neon's user list. */
  async signUp(email: string, password: string, name: string): Promise<AuthSession> {
    const res = await this.call('POST', '/sign-up/email', { body: { email, password, name } })
    const session = this.toSession(res)
    // No session means the project asks new users to confirm their email first.
    if (!session) throw new AccountError('Almost there: check your email and confirm your address, then sign in.')
    return session
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const res = await this.call('POST', '/sign-in/email', { body: { email, password, rememberMe: true } }).catch((err: unknown) => {
      // Whatever was wrong with the email or password, the answer reads the same.
      if (err instanceof AccountError && err.code && err.code !== 'rate_limited' && err.code !== 'EMAIL_NOT_VERIFIED') throw new AccountError(SIGN_IN_FAILED)
      throw err
    })
    const session = this.toSession(res)
    if (!session) throw new AccountError('Sign-in failed. Try again.')
    return session
  }

  /**
   * Checks a saved session and gets a fresh token for the Vanity server.
   * Null means the session is over (expired, or signed out everywhere): sign in again.
   */
  async session(cookie: string): Promise<AuthSession | null> {
    const res = await this.call('GET', '/get-session', { cookie })
    const session = this.toSession(res, cookie)
    if (!session) return null
    if (!session.jwt) {
      const token = await this.call('GET', '/token', { cookie: session.cookie })
      session.jwt = typeof token.json?.token === 'string' ? token.json.token : null
    }
    return session
  }

  /** Ends the session on the server, so the saved cookie is worthless afterwards. */
  async signOut(cookie: string): Promise<void> {
    await this.call('POST', '/sign-out', { cookie })
  }

  /** Ends every session of this account except the one the cookie belongs to. */
  async revokeOtherSessions(cookie: string): Promise<void> {
    await this.call('POST', '/revoke-other-sessions', { cookie })
  }

  /**
   * Emails a 6-digit code for choosing a new password, if an account uses that email.
   * It never says whether one does: only being offline or asking too often is an error.
   */
  async sendResetCode(email: string): Promise<void> {
    try {
      await this.call('POST', '/email-otp/send-verification-otp', { body: { email, type: 'forget-password' } })
    } catch (err) {
      if (err instanceof AccountError && (err.offline || err.code === 'rate_limited')) throw err
    }
  }

  async resetPassword(email: string, code: string, password: string): Promise<void> {
    await this.call('POST', '/email-otp/reset-password', { body: { email, otp: code, password } }).catch((err: unknown) => {
      // "No such account" would give away who has one: it reads like a wrong code.
      if (err instanceof AccountError && err.code === 'USER_NOT_FOUND') throw new AccountError(MESSAGES.INVALID_OTP)
      throw err
    })
  }
}
