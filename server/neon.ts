// Vanity's online side, declared for Neon (https://neon.com/docs). `neon deploy` reads this file
// and makes the Neon project match it. The "Deploy backend" GitHub workflow runs that for you.
import { defineConfig } from '@neon/config/v1'

export default defineConfig({
  // Neon Auth: sign-up, sign-in, sessions and password-reset emails. Vanity has no password code of its own.
  auth: true,
  functions: {
    // The Vanity server (src/function.ts): usernames, friends, presence and shared stats.
    // Neon injects DATABASE_URL and NEON_AUTH_JWKS_URL, so it needs no settings for those.
    vanity: {
      name: 'Vanity API',
      source: 'src/function.ts'
    }
  }
})
