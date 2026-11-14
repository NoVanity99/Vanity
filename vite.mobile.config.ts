// Builds the Android app's web layer: the same interface as the desktop app (src/renderer),
// with src/mobile as its backend instead of Electron. Output goes to dist-mobile/, which
// Capacitor copies into the Android project (capacitor.config.json: webDir).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const version = (JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version

/**
 * The phone app talks to the web services itself (the desktop app does that in its main process),
 * loads artwork straight from the web, and plays the phone's own music files.
 */
const MOBILE_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https: content:; media-src 'self' blob: https://localhost content:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; font-src 'self' data:"

function mobileHtml(): Plugin {
  return {
    name: 'vanity-mobile-html',
    transformIndexHtml(html) {
      const out = html
        .replace(/(http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/, `$1${MOBILE_CSP}$2`)
        .replace('<meta name="viewport"', '<meta name="viewport-desktop"')
        .replace('<head>', '<head>\n    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />')
      if (!out.includes(MOBILE_CSP)) throw new Error('Could not set the mobile Content-Security-Policy in index.html')
      return out
    }
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      '@platform': resolve(__dirname, 'src/mobile/index.ts'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src'),
      // The shared code's few Node imports: paths work as-is, files don't exist on Android.
      'node:path': 'path-browserify',
      'node:fs': resolve(__dirname, 'src/mobile/stubs/fs.ts')
    }
  },
  plugins: [react(), tailwindcss(), mobileHtml()],
  build: { outDir: resolve(__dirname, 'dist-mobile'), emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000 }
})
