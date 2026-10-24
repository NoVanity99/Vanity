import { describe, expect, it } from 'vitest'
import { shuffledIndices } from '../shuffle'

describe('shuffledIndices', () => {
  it('is a permutation', () => {
    const order = shuffledIndices(50)
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i))
  })

  it('varies between calls', () => {
    const a = shuffledIndices(30).join()
    expect(Array.from({ length: 5 }, () => shuffledIndices(30).join()).some((b) => b !== a)).toBe(true)
  })

  it('handles empty and single lists', () => {
    expect(shuffledIndices(0)).toEqual([])
    expect(shuffledIndices(1)).toEqual([0])
  })
})
