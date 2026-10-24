import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'src/shared')

// Built-in API keys come from .env.local. Point out the usual Windows mistakes.
if (!existsSync(resolve(__dirname, '.env.local'))) {
  const misnamed = ['.env.local.txt', 'env.local'].find((f) => existsSync(resolve(__dirname, f)))
  console.warn(
    misnamed
      ? `[vanity] Found "${misnamed}" but not ".env.local". Rename it (or run "npm run setup-keys") so your API keys are used.`
      : '[vanity] No .env.local found: no built-in API keys. Run "npm run setup-keys", or enter keys in the app.'
  )
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': shared
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
