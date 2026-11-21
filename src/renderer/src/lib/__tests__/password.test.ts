import { describe, expect, it } from 'vitest'
import { passwordStrength } from '../password'

describe('password strength', () => {
  it('rates from too short to strong', () => {
    expect(passwordStrength('').score).toBe(0)
    expect(passwordStrength('abc').tip).toBe('5 more characters needed.')
    expect(passwordStrength('abcdefg').tip).toBe('1 more character needed.')
    expect(passwordStrength('hellothere').score).toBe(1)
    expect(passwordStrength('hellothere1').score).toBe(2)
    expect(passwordStrength('Hello-there-12').score).toBe(4)
    expect(passwordStrength('correct horse battery staple').score).toBeGreaterThanOrEqual(3)
  })
  it('calls out passwords that are easy to guess, however long', () => {
    for (const p of ['password123', 'Password!2024', '12345678', 'aaaaaaaaaaaa', 'abcdefgh', 'MyVanity99!', 'qwertyuiop']) expect(passwordStrength(p)).toMatchObject({ score: 1, label: 'Weak' })
  })
})
