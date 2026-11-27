/// <reference types="vite/client" />

// Optional API credentials built in from .env.local (see .env.example).
interface ImportMetaEnv {
  readonly MAIN_VITE_STEAMGRIDDB_API_KEY?: string
  readonly MAIN_VITE_IGDB_CLIENT_ID?: string
  readonly MAIN_VITE_GITHUB_TOKEN?: string
  readonly MAIN_VITE_DISCORD_CLIENT_ID?: string
  readonly MAIN_VITE_UPDATE_KEY?: string
  /** "1" when the Mac app is built with an Apple Developer ID signature (it can then update itself). */
  readonly MAIN_VITE_MAC_SIGNED?: string
  readonly MAIN_VITE_IGDB_CLIENT_SECRET?: string
  /** Address of the old Vercel server. Only the run-from-source updater still uses it. */
  readonly MAIN_VITE_VANITY_API_URL?: string
  /** Development only: use another Neon Auth address / Vanity server than the built-in ones (src/shared/backend.ts). */
  readonly MAIN_VITE_NEON_AUTH_URL?: string
  readonly MAIN_VITE_VANITY_BACKEND_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// electron-vite: `import x from 'file?asset'` gives the file's path at runtime.
declare module '*?asset' {
  const path: string
  export default path
}
