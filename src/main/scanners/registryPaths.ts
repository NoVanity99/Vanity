export const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
]

/** Normalizes a registry path value: strips quotes, a trailing ",0" icon index and fixes slashes. */
export function cleanPathValue(value: string | undefined): string | null {
  if (!value) return null
  const v = value
    .trim()
    .replace(/,\s*-?\d+$/, '')
    .replace(/^"(.*)"$/, '$1')
    .replace(/\//g, '\\')
    .replace(/\\+$/, '')
  return v || null
}
