// A stand-in for the Legendary program, printing what the real one prints (formats taken from
// Legendary's source). State lives in LEGENDARY_CONFIG_PATH, like the real thing.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.env.LEGENDARY_CONFIG_PATH
mkdirSync(dir, { recursive: true })
const file = (name) => join(dir, name)
const readJson = (name, fallback) => (existsSync(file(name)) ? JSON.parse(readFileSync(file(name), 'utf8')) : fallback)
const user = () => readJson('user.json', null)
const log = (who, level, msg) => process.stderr.write(`[${who}] ${level}: ${msg}\n`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)

const LIBRARY = [
  { app_name: 'Fortnite', app_title: 'Fortnite', metadata: { keyImages: [{ type: 'DieselGameBoxTall', url: 'https://cdn1.epicgames.com/fn-tall.jpg' }, { type: 'DieselGameBox', url: 'https://cdn1.epicgames.com/fn-wide.jpg' }] }, dlcs: [] },
  { app_name: 'Sugar', app_title: 'Rocket League® ', metadata: { keyImages: [] }, dlcs: [] },
  { app_name: '9d2d0eb64d5c44529cece33fe2a46482', app_title: 'Alan Wake 2', metadata: {}, dlcs: [] }
]
const SIZES = { Fortnite: [40_000, 90_000], Sugar: [20_000, 30_000], '9d2d0eb64d5c44529cece33fe2a46482': [80_000, 100_000] }

const requireLogin = () => {
  if (!user()) {
    process.stderr.write('Traceback (most recent call last):\n  File "legendary/core.py", line 190, in _login\nValueError: No saved credentials\n')
    process.exit(1)
  }
}

const command = args[0]
if (command === 'status') {
  process.stderr.write('[Core] WARNING: Could not determine locale, falling back to en-US\n')
  process.stdout.write(JSON.stringify({ account: user()?.displayName ?? '<not logged in>', games_available: 0, games_installed: 0, egl_sync_enabled: false, config_directory: dir }) + '\n')
} else if (command === 'auth') {
  if (flag('--delete')) {
    rmSync(file('user.json'), { force: true })
    log('cli', 'INFO', 'User data deleted.')
  } else {
    const code = value('--code')
    if (code === 'a'.repeat(32)) {
      writeFileSync(file('user.json'), JSON.stringify({ displayName: 'JordanPlays' }))
      log('cli', 'INFO', 'Successfully logged in as "JordanPlays"')
    } else {
      log('cli', 'ERROR', 'Login attempt failed, please see log for details.')
      process.exit(1)
    }
  }
} else if (command === 'list') {
  requireLogin()
  log('Core', 'INFO', 'Trying to re-use existing login session...')
  process.stdout.write(JSON.stringify(LIBRARY) + '\n')
} else if (command === 'info') {
  requireLogin()
  const size = SIZES[args[1]]
  if (!size) {
    log('cli', 'ERROR', `Could not find "${args[1]}" in list of available games, did you type the name correctly?`)
    process.exit(1)
  }
  process.stdout.write(JSON.stringify({ game: { app_name: args[1], title: args[1] }, manifest: { download_size: size[0], disk_size: size[1] } }) + '\n')
} else if (command === 'install') {
  requireLogin()
  const app = args[1]
  const size = SIZES[app]
  if (!size) {
    log('cli', 'ERROR', `Could not find "${app}" in list of available games, did you type the name correctly?`)
    process.exit(1)
  }
  const base = value('--base-path')
  const path = join(base, app)
  mkdirSync(path, { recursive: true })
  const MIB = 1024 * 1024
  log('cli', 'INFO', `Preparing download for "${app}" (${app})...`)
  log('cli', 'INFO', `Install path: ${path}`)
  log('cli', 'INFO', `Install size: ${(size[1] / MIB).toFixed(2)} MiB`)
  log('cli', 'INFO', `Download size: ${(size[0] / MIB).toFixed(2)} MiB (Compression savings: 55.5%)`)
  log('cli', 'INFO', 'Downloads are resumable, you can interrupt the download with CTRL-C and resume it using the same command later on.')
  if (process.env.FAKE_LEGENDARY_FAIL === 'space') {
    process.stdout.write('\nInstallation requirements check returned the following results:\n ! Failure: Not enough available disk space! 1.00 GiB < 90.00 GiB\n')
    log('cli', 'ERROR', 'Installation cannot proceed, exiting.')
    process.exit(1)
  }
  // Resumable: remembers how far it got.
  const steps = 10
  let step = readJson(`${app}.resume`, 0)
  const tick = Number(process.env.FAKE_LEGENDARY_TICK_MS ?? 15)
  for (; step < steps; ) {
    await sleep(tick)
    step++
    writeFileSync(file(`${app}.resume`), String(step))
    writeFileSync(join(path, `chunk-${step}.bin`), 'x')
    const perc = (step / steps) * 100
    log('DLManager', 'INFO', `= Progress: ${perc.toFixed(2)}% (${step}/${steps}), Running for 00:00:0${step % 10}, ETA: 00:00:${String(steps - step).padStart(2, '0')}`)
    log('DLManager', 'INFO', ` - Downloaded: ${((size[0] * step) / steps / MIB).toFixed(2)} MiB, Written: ${((size[1] * step) / steps / MIB).toFixed(2)} MiB`)
    log('DLManager', 'INFO', ' - Cache usage: 0.00 MiB, active tasks: 2')
    log('DLManager', 'INFO', ' + Download\t- 12.50 MiB/s (raw) / 30.00 MiB/s (decompressed)')
    log('DLManager', 'INFO', ' + Disk\t- 25.00 MiB/s (write) / 0.00 MiB/s (read)')
    if (process.env.FAKE_LEGENDARY_FAIL === 'network' && step === 3) {
      process.stderr.write("requests.exceptions.ConnectionError: HTTPSConnectionPool(host='epicgames-download1.akamaized.net', port=443): Max retries exceeded\n")
      process.exit(1)
    }
  }
  const installed = readJson('installed.json', {})
  installed[app] = { app_name: app, title: LIBRARY.find((g) => g.app_name === app).app_title.trim(), install_path: path, executable: 'Game.exe', is_dlc: false }
  writeFileSync(file('installed.json'), JSON.stringify(installed))
  rmSync(file(`${app}.resume`), { force: true })
  log('cli', 'INFO', 'Finished installation process in 0.15 seconds.')
} else if (command === 'launch') {
  writeFileSync(file('launched.txt'), args[1])
} else {
  process.exit(2)
}
