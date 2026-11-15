import { sanitizeProfile } from '@shared/profile'
import type { AuthHttp } from '../main/account/neonAuth'
import type { SavedSession, SessionVault } from '../main/account/service'
import { native } from './native'

const KEY = 'account-session'

/** Requests to Neon Auth go through the app's own code, so the Cookie and Origin headers can be set. */
export const mobileAuthHttp: AuthHttp = async (req) => {
  if (!native.http) throw new Error('Sign-in is not available here')
  return native.http(req)
}

/** The session is encrypted with a key that never leaves the phone's Keystore. */
export const mobileSessionVault: SessionVault = {
  async load() {
    if (!native.secureGet) return null
    const { value } = await native.secureGet({ key: KEY })
    if (!value) return null
    try {
      const parsed = JSON.parse(value) as Partial<SavedSession>
      if (typeof parsed.cookie !== 'string' || typeof parsed.userId !== 'string') return null
      return {
          cookie: parsed.cookie,
          userId: parsed.userId,
          email: String(parsed.email ?? ''),
          username: typeof parsed.username === 'string' ? parsed.username : null,
          avatar: typeof parsed.avatar === 'string' ? parsed.avatar : null,
          bio: typeof parsed.bio === 'string' ? parsed.bio : '',
          style: sanitizeProfile(parsed.style),
          verified: parsed.verified === true,
          admin: parsed.admin === true
        }
    } catch {
      return null
    }
  },
  async save(session) {
    if (!native.secureSet) return
    await native.secureSet({ key: KEY, value: session ? JSON.stringify(session) : null })
  }
}
