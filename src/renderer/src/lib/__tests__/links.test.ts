import { describe, expect, it } from 'vitest'
import { splitLinks } from '../../components/chat/LinkText'

const links = (t: string): string[] => splitLinks(t).filter((p) => p.href).map((p) => p.href!)

describe('links in chat messages', () => {
  it('finds web addresses and leaves the sentence around them alone', () => {
    expect(splitLinks('look at https://example.com/a?b=1 now')).toEqual([{ text: 'look at ' }, { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' }, { text: ' now' }])
    expect(links('See www.vanity.gg. Or (http://a.co/x), ok?')).toEqual(['https://www.vanity.gg', 'http://a.co/x'])
    expect(links('wiki https://en.wikipedia.org/wiki/Portal_(video_game) yes')).toEqual(['https://en.wikipedia.org/wiki/Portal_(video_game)'])
    expect(splitLinks('two https://a.com https://b.com').map((p) => p.text).join('')).toBe('two https://a.com https://b.com')
  })
  it('only makes real http and https addresses clickable', () => {
    for (const t of ['javascript:alert(1)', 'file:///c:/windows', 'vanity://x', 'data:text/html,hi', 'no links here', 'http://', 'https://localhost', 'mailto:a@b.com']) expect(links(t)).toEqual([])
  })
})
