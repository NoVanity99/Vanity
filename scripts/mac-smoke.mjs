// Checks the built Mac app really works, on a Mac (the release workflow runs it on GitHub's
// macOS machine). Usage: node scripts/mac-smoke.mjs <path to Vanity.app> <folder for screenshots>
//
// It puts a pretend Steam library in ~/Library/Application Support/Steam and a pretend game app
// in ~/Applications, opens Vanity, scans, and checks:
//   - the app starts, and keeps its data in ~/Library/Application Support/Vanity;
//   - it finds the Steam game and the Mac game;
//   - Play starts the Mac game (the pretend game writes a file when it runs).
// Needs playwright-core (npm install --no-save playwright-core).
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright-core')
const [appPath, shots = 'mac-smoke'] = process.argv.slice(2)
if (!appPath) throw new Error('Usage: node scripts/mac-smoke.mjs <Vanity.app> [screenshot folder]')
mkdirSync(shots, { recursive: true })

const home = homedir()
let failed = false
const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed = true
}

// A pretend Steam library with one installed game.
const steam = join(home, 'Library', 'Application Support', 'Steam')
mkdirSync(join(steam, 'steamapps', 'common', 'Smoke Test Quest'), { recursive: true })
writeFileSync(join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n}\n`)
writeFileSync(join(steam, 'steamapps', 'appmanifest_480.acf'), `"AppState"\n{\n\t"appid"\t\t"480"\n\t"name"\t\t"Smoke Test Quest"\n\t"StateFlags"\t\t"4"\n\t"installdir"\t\t"Smoke Test Quest"\n}\n`)

// A pretend Mac game: an app whose program writes a file when it is opened.
const ranFile = join(tmpdir(), 'vanity-smoke-game-ran')
rmSync(ranFile, { force: true })
const game = join(home, 'Applications', 'Smoke Arcade.app')
mkdirSync(join(game, 'Contents', 'MacOS'), { recursive: true })
writeFileSync(join(game, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>SmokeArcade</string>
<key>CFBundleIdentifier</key><string>com.example.smokearcade</string>
<key>CFBundleName</key><string>Smoke Arcade</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSApplicationCategoryType</key><string>public.app-category.arcade-games</string>
</dict></plist>`)
writeFileSync(join(game, 'Contents', 'MacOS', 'SmokeArcade'), `#!/bin/sh\ntouch "${ranFile}"\nsleep 8\n`)
chmodSync(join(game, 'Contents', 'MacOS', 'SmokeArcade'), 0o755)

const executable = join(appPath, 'Contents', 'MacOS', 'Vanity')
const app = await electron.launch({ executablePath: executable, args: [], timeout: 60_000 })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.setViewportSize({ width: 1280, height: 800 }).catch(() => {})
  await win.waitForSelector('[data-title-strip]', { timeout: 60_000 })
  step('the app opens its window', true)
  step('the screens know they are on a Mac', (await win.evaluate(() => document.documentElement.dataset.os)) === 'darwin')

  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  step('data is kept in ~/Library/Application Support/Vanity', userData === join(home, 'Library', 'Application Support', 'Vanity'), userData)
  step('logs go to ~/Library/Logs/Vanity', (await app.evaluate(({ app }) => app.getPath('logs'))) === join(home, 'Library', 'Logs', 'Vanity'))
  step('the library database is there', existsSync(join(userData, 'vanity.db')))
  step('the Mac menu bar is set (Vanity, Edit, View, Window, Help)', JSON.stringify(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label))) === JSON.stringify(['Vanity', 'Edit', 'View', 'Window', 'Help']))
  const options = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return { lights: w.getWindowButtonPosition?.() ?? null }
  })
  step('the traffic lights are placed in Vanity\'s corner', !!options.lights && options.lights.x === 16, JSON.stringify(options.lights))

  const summary = await win.evaluate(() => window.vanity.scan.start())
  const games = await win.evaluate(() => window.vanity.games.list())
  const names = games.map((g) => `${g.source}:${g.name}`)
  step('it finds the Steam game', names.includes('steam:Smoke Test Quest'), names.join(', '))
  step('it finds the Mac game in ~/Applications', names.includes('macapp:Smoke Arcade'), JSON.stringify(summary.progress))

  const arcade = games.find((g) => g.name === 'Smoke Arcade')
  const error = await win.evaluate((id) => window.vanity.games.launch(id), arcade.id)
  step('Play starts the Mac game', error === null, String(error))
  for (let i = 0; i < 20 && !existsSync(ranFile); i++) await new Promise((r) => setTimeout(r, 500))
  step('the Mac game really ran', existsSync(ranFile))

  await win.screenshot({ path: join(shots, 'vanity-mac.png') })
  // Closing the window keeps the app running (the Mac way).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await new Promise((r) => setTimeout(r, 800))
  const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()))
  step('closing the window keeps Vanity running in the Dock', after.length === 1 && after[0] === false, JSON.stringify(after))
  await app.evaluate(({ app }) => app.emit('activate'))
  await new Promise((r) => setTimeout(r, 800))
  step('clicking the Dock icon brings the window back', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())) === true)
} catch (err) {
  step('the check finished', false, String(err).slice(0, 400))
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {})
}
if (existsSync(join(home, 'Library', 'Logs', 'Vanity'))) console.log('logs folder: present')
console.log(failed ? '\nSome checks failed.' : '\nAll checks passed.')
process.exit(failed ? 1 : 0)
