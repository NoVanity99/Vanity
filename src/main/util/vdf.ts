/** A parsed Valve KeyValues (VDF/ACF) node. Keys keep their original case. */
export interface VdfObject {
  [key: string]: string | VdfObject
}

/**
 * Parses Valve's text KeyValues format, used by libraryfolders.vdf and
 * appmanifest_*.acf. Handles quoted and unquoted tokens, escape sequences,
 * // comments and duplicate keys (the last one wins).
 */
export function parseVdf(text: string): VdfObject {
  const tokens = tokenize(text)
  let i = 0

  function parseObject(): VdfObject {
    const obj: VdfObject = {}
    while (i < tokens.length) {
      const token = tokens[i++]
      if (token.type === 'close') return obj
      if (token.type !== 'string') continue
      const next = tokens[i]
      if (!next) break
      if (next.type === 'open') {
        i++
        obj[token.value] = parseObject()
      } else if (next.type === 'string') {
        i++
        obj[token.value] = next.value
      }
    }
    return obj
  }

  return parseObject()
}

type Token = { type: 'string'; value: string } | { type: 'open' } | { type: 'close' }

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '{') {
      tokens.push({ type: 'open' })
      i++
    } else if (c === '}') {
      tokens.push({ type: 'close' })
      i++
    } else if (c === '"') {
      i++
      let value = ''
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          const e = text[i + 1]
          value += e === 'n' ? '\n' : e === 't' ? '\t' : e
          i += 2
        } else {
          value += text[i++]
        }
      }
      i++ // closing quote
      tokens.push({ type: 'string', value })
    } else if (/\s/.test(c)) {
      i++
    } else {
      let value = ''
      while (i < text.length && !/[\s{}"]/.test(text[i])) value += text[i++]
      tokens.push({ type: 'string', value })
    }
  }
  return tokens
}

/** Case-insensitive child lookup. */
export function vdfGet(obj: VdfObject | undefined, key: string): string | VdfObject | undefined {
  if (!obj) return undefined
  const lower = key.toLowerCase()
  for (const [k, v] of Object.entries(obj)) if (k.toLowerCase() === lower) return v
  return undefined
}
