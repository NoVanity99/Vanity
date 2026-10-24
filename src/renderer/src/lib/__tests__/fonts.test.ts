import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FONT_GROUPS, FONT_THEMES } from '@shared/fonts'

const ROOT = join(__dirname, '../../../../..')
const SYSTEM = new Set(['Segoe UI Variable', 'Segoe UI'])

describe('font themes', () => {
  it('has unique IDs, and every theme is in a group', () => {
    expect(new Set(FONT_THEMES.map((f) => f.id)).size).toBe(FONT_THEMES.length)
    for (const f of FONT_THEMES) expect(FONT_GROUPS).toContain(f.group)
  })

  it('only uses fonts that are bundled (imported in main.tsx)', () => {
    const main = readFileSync(join(ROOT, 'src/renderer/src/main.tsx'), 'utf8')
    const imports = [...main.matchAll(/import '(@fontsource[^']+)'/g)].map((m) => m[1])
    const bundled = new Set<string>()
    for (const spec of imports) {
      const css = spec.endsWith('.css') ? spec : `${spec}/index.css`
      for (const m of readFileSync(join(ROOT, 'node_modules', css), 'utf8').matchAll(/font-family: '([^']+)'/g)) bundled.add(m[1])
    }
    const used = new Set(FONT_THEMES.flatMap((f) => [...`${f.body},${f.display}`.matchAll(/'([^']+)'/g)].map((m) => m[1])))
    for (const family of used) if (!SYSTEM.has(family)) expect(bundled, family).toContain(family)
  })
})
