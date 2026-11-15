// The Android build's "@platform": opens the library database and installs window.vanity,
// the same interface the desktop app's preload script provides.
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { createMobileApi } from './api'
import { openMobileDatabase } from './db'
import { createSaver, loadDatabase } from './persist'
import { installBackButton, installLongPress } from './touch'

declare const __APP_VERSION__: string

async function start(): Promise<void> {
  document.documentElement.dataset.platform = 'android'
  const [SQL, saved] = await Promise.all([initSqlJs({ locateFile: () => wasmUrl }), loadDatabase()])
  // The saver needs the database and the database needs the saver's callback: tie them together here.
  let exportBytes: () => Uint8Array = () => new Uint8Array()
  const saver = createSaver(() => exportBytes())
  const { db, mobile } = openMobileDatabase(SQL, saved, () => saver.schedule())
  exportBytes = () => mobile.export()
  saver.schedule()
  window.vanity = createMobileApi(db, __APP_VERSION__)
  installLongPress()
  installBackButton()
}

export const ready: Promise<void> = start().catch((err) => {
  console.error('[vanity] could not start:', err)
  document.getElementById('root')!.innerHTML =
    '<div style="display:grid;place-items:center;height:100%;padding:2rem;text-align:center;font-family:system-ui;color:#e8ebf1"><div><h1 style="font-size:1.3rem">Vanity could not start</h1><p style="color:#8a91a0">Close the app and open it again. If this keeps happening, reinstall Vanity.</p></div></div>'
  throw err
})
