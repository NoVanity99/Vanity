// Gets the project ready to build the Universal Mac app (Apple Silicon + Intel in one).
//
// npm installs a native package's files only for the computer it runs on, but a Universal app
// carries both halves. The music player's ffmpeg comes as two separate packages
// (@ffmpeg-installer/darwin-arm64 and darwin-x64), so the one npm skipped is fetched here.
// (SQLite and the push-to-talk key listener already include both in one package.)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const wanted = JSON.parse(readFileSync(join(root, 'node_modules', '@ffmpeg-installer', 'ffmpeg', 'package.json'), 'utf8')).optionalDependencies

for (const arch of ['darwin-arm64', 'darwin-x64']) {
  const name = `@ffmpeg-installer/${arch}`
  const dest = join(root, 'node_modules', '@ffmpeg-installer', arch)
  if (existsSync(join(dest, 'ffmpeg'))) {
    console.log(`ok    ${name} is there`)
    continue
  }
  const tmp = mkdtempSync(join(tmpdir(), 'vanity-mac-'))
  try {
    const file = execFileSync(npm, ['pack', `${name}@${wanted[name]}`, '--silent'], { cwd: tmp, encoding: 'utf8' }).trim().split('\n').pop()
    mkdirSync(dest, { recursive: true })
    execFileSync('tar', ['-xzf', join(tmp, file), '-C', dest, '--strip-components=1'])
    console.log(`ok    fetched ${name}@${wanted[name]}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
