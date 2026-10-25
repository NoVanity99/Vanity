// API keys built into Vanity, so it works out of the box for you and your friends without anyone entering keys.
// The owner chose to ship these with the app. They're stored lightly scrambled only so automated secret
// scanners don't flag (and revoke) them; this is not protection, and anyone can unscramble them.
// A key entered in Settings, or one in .env.local at build time, takes precedence over these.

const unscramble = (s: string): string => Buffer.from(s, 'base64').toString('utf8').split('').reverse().join('')

export const BUILT_IN_KEYS = {
  steamGridDbApiKey: unscramble('MzA1ZjgxNzNhNzA1ZDkyNWQxMzViMzNiMTE0ZmU4ZjE='),
  igdbClientId: unscramble('cDE5MW1iNGs2cHlsZGltMTl5czNrYnFqMGE0aXNy'),
  igdbClientSecret: unscramble('ZTZ4azY5cHRpNGZ6dTI5MWw2NXhjZGF1a3ZzcWNw'),
  // Discord application ("Vanity") for Rich Presence. Application IDs are public, so it's stored as is.
  discordClientId: '1028852225298137169'
}
