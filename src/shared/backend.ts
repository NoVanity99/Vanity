/**
 * Where Vanity's online side lives: both are on Neon (see server/README.md).
 *
 * These two addresses are public: they are sent with every request anyway, and knowing them
 * gives no access. Nothing secret belongs in this file. The Steam Web API key and the database
 * password stay on the server and never reach the app or this repository.
 *
 * Empty means accounts are switched off in this build.
 */
export const BACKEND = {
  /** Neon Auth address of the project (Neon console → Auth), e.g. https://ep-xxxx.neonauth.us-east-2.aws.neon.tech/neondb/auth */
  authUrl: '',
  /** Address of the "vanity" Neon Function: printed by the "Deploy backend" workflow. */
  apiUrl: '',
  /**
   * Sent as the Origin of sign-in requests. Neon Auth only answers origins on its trusted list,
   * and local addresses are on it by default, so no extra setup is needed.
   */
  origin: 'http://localhost:5173'
} as const

export interface BackendConfig {
  authUrl: string
  apiUrl: string
  origin: string
}

const clean = (url: string | undefined): string => (url ?? '').trim().replace(/\/+$/, '')

/** The built-in addresses, unless a development build overrides them. */
export function backendConfig(override: Partial<BackendConfig> = {}): BackendConfig {
  return {
    authUrl: clean(override.authUrl) || clean(BACKEND.authUrl),
    apiUrl: clean(override.apiUrl) || clean(BACKEND.apiUrl),
    origin: clean(override.origin) || BACKEND.origin
  }
}
