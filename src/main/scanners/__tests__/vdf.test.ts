import { describe, expect, it } from 'vitest'
import { parseVdf, vdfGet } from '../../util/vdf'

describe('parseVdf', () => {
  it('parses nested objects, escaped backslashes and comments', () => {
    const text = `// header comment
"libraryfolders"
{
  "0"
  {
    "path"    "C:\\\\Program Files (x86)\\\\Steam"
    "apps" { "730" "123" }
  }
  "1" { "path" "D:\\\\SteamLibrary" }
}`
    const root = parseVdf(text)
    const folders = vdfGet(root, 'LibraryFolders') as Record<string, Record<string, string>>
    expect(folders['0'].path).toBe('C:\\Program Files (x86)\\Steam')
    expect(folders['1'].path).toBe('D:\\SteamLibrary')
  })

  it('handles unquoted tokens and a BOM', () => {
    const root = parseVdf('\uFEFFAppState { appid 10 name "Counter-Strike" }')
    expect(vdfGet(root, 'AppState')).toEqual({ appid: '10', name: 'Counter-Strike' })
  })

  it('does not throw on truncated input', () => {
    expect(() => parseVdf('"AppState" { "appid" "1')).not.toThrow()
  })
})
