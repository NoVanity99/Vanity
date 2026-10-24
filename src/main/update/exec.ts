import { spawn } from 'node:child_process'

const WIN = process.platform === 'win32'

/**
 * Runs a program and resolves to its stdout. npm and npx are .cmd scripts on
 * Windows, so they go through the shell there. Git never prompts (no hidden
 * password prompts that would hang a background check).
 */
export function exec(cmd: string, args: string[], opts: { cwd: string; timeoutMs?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      shell: WIN && (cmd === 'npm' || cmd === 'npx'),
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : null
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(err.trim() || out.trim() || `${cmd} exited with code ${code}`))
    })
  })
}

/** Unpacks a zip with the system's tools: tar on Windows 10+, unzip elsewhere. */
export async function unzip(zipFile: string, dest: string): Promise<void> {
  if (WIN) await exec('tar', ['-xf', zipFile, '-C', dest], { cwd: dest, timeoutMs: 5 * 60_000 })
  else await exec('unzip', ['-q', '-o', zipFile, '-d', dest], { cwd: dest, timeoutMs: 5 * 60_000 })
}
