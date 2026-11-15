import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

/** Who a request is from, taken from a verified Neon Auth token. */
export interface AuthUser {
  /** The Neon Auth user id. */
  id: string
  email: string | null
}

/** Checks a session token and says whose it is, or null when it is invalid or expired. */
export type VerifyToken = (token: string) => Promise<AuthUser | null>

/**
 * Verifies Neon Auth's tokens (JWTs signed with the branch's own key, valid for about 15 minutes).
 * Vanity never sees or stores passwords: sign-in happens at Neon Auth, and the app sends us the token it gets back.
 */
export function neonAuthVerifier(keys: JWTVerifyGetKey): VerifyToken {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, { algorithms: ['EdDSA'], clockTolerance: 10 })
      if (typeof payload.sub !== 'string' || !payload.sub) return null
      return { id: payload.sub, email: typeof payload.email === 'string' ? payload.email : null }
    } catch {
      return null
    }
  }
}

/** The verifier for a deployed server: keys are fetched from Neon Auth's JWKS address and cached. */
export function neonAuthVerifierFromUrl(jwksUrl: string): VerifyToken {
  return neonAuthVerifier(createRemoteJWKSet(new URL(jwksUrl)))
}
