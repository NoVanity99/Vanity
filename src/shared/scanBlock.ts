// The scan block list: files the library scanner must never suggest again
// (Settings → Library → Scan Block List). Stored in settings as `ignoredExecutables`.

/**
 * A file path in one comparable form: no difference between \ and /, doubled slashes or capitals
 * (Windows treats those as the same file). Two games with the same exe name in different folders
 * stay different, because the whole path is compared.
 */
export function normalizeExePath(path: string): string {
  return path.trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** The file's own name, for showing ("Game.exe"). */
export function exeName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/** Adds a file to the list (once), keeping the path as it was first seen for display. */
export function blockExe(list: readonly string[], path: string): string[] {
  const key = normalizeExePath(path)
  return list.some((p) => normalizeExePath(p) === key) ? [...list] : [...list, path]
}

export function unblockExe(list: readonly string[], path: string): string[] {
  const key = normalizeExePath(path)
  return list.filter((p) => normalizeExePath(p) !== key)
}
