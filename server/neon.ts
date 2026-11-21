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
      source: 'src/function.ts',
      env: {
        // The Steam Web API key: a secret that only this function can read. It is never in the app
        // or in this repository. The Deploy backend workflow passes it from the GitHub secret
        // STEAM_WEB_API_KEY. A deploy without it keeps the value that is already set.
        STEAM_WEB_API_KEY: { value: process.env.STEAM_WEB_API_KEY, required: false, onUndefined: 'skip' },
        // GIF search in chats (https://partner.klipy.com). Optional; without it, GIFs come from people's devices only.
        KLIPY_API_KEY: { value: process.env.KLIPY_API_KEY, required: false, onUndefined: 'skip' },
        // Vanity Coins: Stripe's secret key and the webhook signing secret (see server/README.md).
        // Server only, passed from GitHub secrets; without them the store says buying isn't set up.
        STRIPE_SECRET_KEY: { value: process.env.STRIPE_SECRET_KEY, required: false, onUndefined: 'skip' },
        STRIPE_WEBHOOK_SECRET: { value: process.env.STRIPE_WEBHOOK_SECRET, required: false, onUndefined: 'skip' },
        // Optional TURN relay for voice rooms (players on strict networks). TURN_SECRET makes each
        // player a short-lived login and never leaves this function. Passed from GitHub secrets.
        TURN_URLS: { value: process.env.TURN_URLS, required: false, onUndefined: 'skip' },
        TURN_SECRET: { value: process.env.TURN_SECRET, required: false, onUndefined: 'skip' },
        TURN_USERNAME: { value: process.env.TURN_USERNAME, required: false, onUndefined: 'skip' },
        TURN_CREDENTIAL: { value: process.env.TURN_CREDENTIAL, required: false, onUndefined: 'skip' }
      }
    }
  }
})
