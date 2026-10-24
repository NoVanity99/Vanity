import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Creates a temp folder tree. Keys are relative paths; values are file contents (or a size in bytes). */
export function makeTree(files: Record<string, string | number>): string {
  const root = mkdtempSync(join(tmpdir(), 'vanity-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, typeof content === 'number' ? Buffer.alloc(content) : content)
  }
  return root
}
