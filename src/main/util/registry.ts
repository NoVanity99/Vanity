import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface RegistryKey {
  /** Full path as requested, e.g. HKLM\SOFTWARE\WOW6432Node\GOG.com\Games */
  path: string
  values: Record<string, string>
  subkeys: { name: string; values: Record<string, string> }[]
}

/**
 * Reads registry keys (their values and one level of subkeys with values) in a
 * single PowerShell call. PowerShell is used instead of reg.exe because it can
 * emit UTF-8, so non-ASCII game names and paths survive intact.
 *
 * Paths must start with HKLM\ or HKCU\. Missing keys are omitted from the result.
 * Never throws: on any failure, or on non-Windows platforms, it returns [].
 */
export async function readRegistryKeys(paths: string[]): Promise<RegistryKey[]> {
  if (process.platform !== 'win32' || paths.length === 0) return []
  // isAvailable() and scan() often read the same keys back to back; reuse the result briefly.
  const cacheKey = paths.join('|').toLowerCase()
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result
  try {
    const result = parseRegistryJson(await runPowerShell(buildScript(paths)))
    cache.set(cacheKey, { at: Date.now(), result })
    return result
  } catch (err) {
    console.warn('[registry] read failed:', err)
    return []
  }
}

const CACHE_MS = 10_000
const cache = new Map<string, { at: number; result: RegistryKey[] }>()

/** Convenience: the values of a single key, or null if it does not exist. */
export async function readRegistryValues(path: string): Promise<Record<string, string> | null> {
  const [key] = await readRegistryKeys([path])
  return key ? key.values : null
}

export function buildScript(paths: string[]): string {
  const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')
  return `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Read-Values($key) {
  $values = @{}
  foreach ($name in $key.GetValueNames()) {
    if ($name -ne '') { $values[$name] = [string]$key.GetValue($name) }
  }
  return $values
}
$result = foreach ($path in @(${list})) {
  $hive, $sub = $path.Split('\\', 2)
  $base = switch ($hive) {
    'HKLM' { [Microsoft.Win32.Registry]::LocalMachine }
    'HKCU' { [Microsoft.Win32.Registry]::CurrentUser }
  }
  if ($null -eq $base) { continue }
  $key = $base.OpenSubKey($sub)
  if ($null -eq $key) { continue }
  $subkeys = @(foreach ($name in $key.GetSubKeyNames()) {
    $child = $key.OpenSubKey($name)
    if ($null -ne $child) {
      @{ name = $name; values = (Read-Values $child) }
      $child.Close()
    }
  })
  @{ path = $path; values = (Read-Values $key); subkeys = $subkeys }
  $key.Close()
}
ConvertTo-Json -InputObject @($result) -Depth 6 -Compress
`
}

/**
 * Runs the script from a temp .ps1 file. (-EncodedCommand would avoid the file,
 * but antivirus tools commonly flag encoded PowerShell as suspicious.)
 */
async function runPowerShell(script: string): Promise<string> {
  const file = join(tmpdir(), `vanity-registry-${randomUUID()}.ps1`)
  // UTF-8 with BOM, so Windows PowerShell 5.1 reads the file as UTF-8.
  await fs.writeFile(file, '\uFEFF' + script, 'utf8')
  try {
    return await new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
        { windowsHide: true, timeout: 20_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout) => (err ? reject(err) : resolve(stdout))
      )
    })
  } finally {
    await fs.rm(file, { force: true })
  }
}

/** Parses the script's JSON output, tolerating PowerShell's array/object quirks. */
export function parseRegistryJson(stdout: string): RegistryKey[] {
  const text = stdout.replace(/^﻿/, '').trim()
  if (!text) return []
  const parsed: unknown = JSON.parse(text)
  return toArray(parsed).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const r = raw as Record<string, unknown>
    if (typeof r.path !== 'string') return []
    return [
      {
        path: r.path,
        values: toValues(r.values),
        subkeys: toArray(r.subkeys).flatMap((s) => {
          if (!s || typeof s !== 'object') return []
          const sub = s as Record<string, unknown>
          return typeof sub.name === 'string' ? [{ name: sub.name, values: toValues(sub.values) }] : []
        })
      }
    ]
  })
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value == null ? [] : [value]
}

function toValues(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (v != null) out[k] = String(v)
  }
  return out
}

/** Case-insensitive value lookup (registry value names are case-insensitive). */
export function getValue(values: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(values)) if (k.toLowerCase() === lower) return v
  return undefined
}
