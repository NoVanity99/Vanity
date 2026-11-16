import { describe, expect, it } from 'vitest'
import { bigEmoji, EMOJI_GROUPS, replaceEmoticon } from '../emoji'

describe('emoji', () => {
  it('has many to pick from, each one whole (joined emoji like 😮‍💨 stay one)', () => {
    const all = EMOJI_GROUPS.flatMap((g) => g.emoji)
    expect(all.length).toBeGreaterThan(450)
    expect(EMOJI_GROUPS.find((g) => g.id === 'smileys')!.emoji).toContain('😮‍💨')
    expect(EMOJI_GROUPS.find((g) => g.id === 'hearts')!.emoji).toContain('❤️‍🔥')
    for (const g of EMOJI_GROUPS) expect(new Set(g.emoji).size).toBe(g.emoji.length)
  })

  it('turns typed faces into emoji once a space follows', () => {
    expect(replaceEmoticon('hi :) ', 6)).toEqual({ text: 'hi 🙂 ', cursor: 3 + '🙂'.length + 1 })
    expect(replaceEmoticon('<3 ', 3)?.text).toBe('❤️ ')
    expect(replaceEmoticon('so :D see', 6)?.text).toBe('so 😄 see')
    // Not before the space, not inside words, addresses or times.
    expect(replaceEmoticon('hi :)', 5)).toBeNull()
    expect(replaceEmoticon('see http:/ ', 11)).toBeNull()
    expect(replaceEmoticon('at 12:30 ', 9)).toBeNull()
    expect(replaceEmoticon('word:) ', 7)).toBeNull()
  })

  it('shows a message of one to three emoji big', () => {
    expect(bigEmoji('😂')).toBe(true)
    expect(bigEmoji(' 🔥🔥🔥 ')).toBe(true)
    expect(bigEmoji('👍🏽')).toBe(true)
    expect(bigEmoji('❤️‍🔥')).toBe(true)
    expect(bigEmoji('😂😂😂😂')).toBe(false)
    expect(bigEmoji('lol 😂')).toBe(false)
    expect(bigEmoji('123')).toBe(false)
    expect(bigEmoji('')).toBe(false)
  })
})
