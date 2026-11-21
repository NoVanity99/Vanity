// A rough guide to how hard a password is to guess. It only advises: 8 characters is the rule.

const COMMON = ['password', '12345678', '123456789', 'qwertyui', 'qwerty123', 'iloveyou', 'letmein', 'welcome', 'vanity', 'abc12345', '11111111', 'football', 'minecraft', 'fortnite']

export interface Strength {
  /** 0 (too short) to 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4
  label: string
  tip: string
}

export function passwordStrength(password: string): Strength {
  const length = [...password].length
  if (length < 8) return { score: 0, label: 'Too short', tip: `${8 - length} more character${8 - length === 1 ? '' : 's'} needed.` }
  const lower = /[a-z]/.test(password)
  const upper = /[A-Z]/.test(password)
  const digit = /\d/.test(password)
  const symbol = /[^A-Za-z0-9]/.test(password)
  const kinds = [lower, upper, digit, symbol].filter(Boolean).length
  const plain = password.toLowerCase()
  const common = COMMON.some((c) => plain.includes(c))
  // One character repeated, or a straight run like abcdefgh / 87654321.
  const lazy = /^(.)\1+$/.test(password) || 'abcdefghijklmnopqrstuvwxyz0123456789'.includes(plain) || '9876543210zyxwvutsrqponmlkjihgfedcba'.includes(plain)
  let points = 0
  if (length >= 10) points++
  if (length >= 14) points++
  if (kinds >= 2) points++
  if (kinds >= 3) points++
  if (kinds === 4 && length >= 12) points++
  if (common || lazy) points = 0
  const score = Math.min(4, Math.max(1, points)) as 1 | 2 | 3 | 4
  const tip = common || lazy ? 'This one is easy to guess. Try something less common.' : score >= 3 ? 'Nice. A few random words work well too.' : length < 12 ? 'Make it longer: length helps the most.' : 'Mix in capitals, numbers or symbols.'
  return { score, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score], tip }
}
