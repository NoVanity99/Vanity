/// <reference types="vite/client" />

// Optional API credentials built in from .env.local (see .env.example).
interface ImportMetaEnv {
  readonly MAIN_VITE_STEAMGRIDDB_API_KEY?: string
  readonly MAIN_VITE_IGDB_CLIENT_ID?: string
  readonly MAIN_VITE_IGDB_CLIENT_SECRET?: string
  /** Vanity account server URL (server/README.md). */
  readonly MAIN_VITE_VANITY_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// electron-vite: `import x from 'file?asset'` gives the file's path at runtime.
declare module '*?asset' {
  const path: string
  export default path
}
