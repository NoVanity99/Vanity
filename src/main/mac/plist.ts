import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { safeReadFile } from '../util/fs'

// Reading an app's Info.plist. Most are XML; some are binary, and macOS's own `plutil` turns
// those into JSON (it is on every Mac).

export type Plist = Record<string, unknown>

/** The plain string and boolean keys of an XML plist's top-level dictionary (enough for Info.plist). */
export function parseXmlPlist(xml: string): Plist | null {
  const body = /<dict>([\s\S]*)<\/dict>\s*<\/plist>/.exec(xml)?.[1]
  if (!body) return null
  const out: Plist = {}
  // Only the outer dictionary: nested <dict>/<array> values are skipped whole.
  const re = /<key>([^<]*)<\/key>\s*(<string>([\s\S]*?)<\/string>|<(true|false)\s*\/>|<integer>(-?\d+)<\/integer>|<(dict|array)\b[^>]*\/>|<(dict|array)\b[^>]*>)/g
  let m: RegExpExecArray | null
  let depthSkip = 0
  while ((m = re.exec(body))) {
    if (depthSkip) break
    const key = decode(m[1])
    if (m[3] !== undefined) out[key] = decode(m[3])
    else if (m[4]) out[key] = m[4] === 'true'
    else if (m[5]) out[key] = Number(m[5])
    else if (m[7]) {
      // Jump past the nested value so its keys aren't read as top-level ones.
      const tag = m[7]
      let depth = 1
      const nest = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'g')
      nest.lastIndex = re.lastIndex
      let n: RegExpExecArray | null
      while (depth && (n = nest.exec(body))) {
        if (n[2]) continue
        depth += n[1] ? -1 : 1
      }
      re.lastIndex = nest.lastIndex
    }
  }
  return out
}

const decode = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

function plutilJson(path: string): Promise<Plist | null> {
  return new Promise((resolve) => {
    execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null)
      try {
        const v = JSON.parse(stdout)
        resolve(v && typeof v === 'object' ? (v as Plist) : null)
      } catch {
        resolve(null)
      }
    })
  })
}

/** An .app's Info.plist, or null when it is missing or unreadable. */
export async function readInfoPlist(appPath: string): Promise<Plist | null> {
  const file = join(appPath, 'Contents', 'Info.plist')
  const text = await safeReadFile(file)
  if (text === null) return null
  if (text.startsWith('bplist')) return process.platform === 'darwin' ? plutilJson(file) : null
  return parseXmlPlist(text)
}
