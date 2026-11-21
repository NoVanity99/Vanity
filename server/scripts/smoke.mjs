// Checks a deployed Vanity backend the way the app uses it: creates a throwaway account at Neon Auth,
// gets a token, talks to the Vanity server with it, then signs out. Run by the "Deploy backend" workflow.
//
//   NEON_AUTH_URL=https://…/neondb/auth VANITY_API_URL=https://…-vanity.compute.… node scripts/smoke.mjs
//
// Prints the throwaway user's id on the last line ("user-id: …") so the workflow can delete it.
const AUTH = (process.env.NEON_AUTH_URL ?? '').replace(/\/+$/, '')
const API = (process.env.VANITY_API_URL ?? '').replace(/\/+$/, '')
const ORIGIN = process.env.VANITY_ORIGIN || 'http://localhost:5173'
if (!AUTH || !API) {
  console.error('Set NEON_AUTH_URL and VANITY_API_URL.')
  process.exit(2)
}

let failed = false
const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed = true
  return ok
}

async function auth(method, path, { body, cookie } = {}) {
  const headers = { origin: ORIGIN, accept: 'application/json' }
  if (cookie) headers.cookie = cookie
  if (method === 'POST') headers['content-type'] = 'application/json'
  const res = await fetch(AUTH + path, { method, headers, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined, redirect: 'manual', signal: AbortSignal.timeout(20_000) })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON
  }
  return { status: res.status, json, text, setCookie: res.headers.getSetCookie(), jwt: res.headers.get('set-auth-jwt') }
}

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON
  }
  return { status: res.status, json, text }
}

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const email = `vanity-smoke-${tag}@example.com`
const password = `Smoke-${tag}-${Math.random().toString(36).slice(2)}`
const username = `smoke_${tag}`.slice(0, 20)
let userId = null

try {
  const root = await api('GET', '')
  step('the Vanity server answers', root.json?.name === 'vanity-api', `HTTP ${root.status}`)
  step('it refuses requests without a sign-in', (await api('GET', '/me')).status === 401)

  const up = await auth('POST', '/sign-up/email', { body: { email, password, name: username } })
  const cookie = up.setCookie.map((c) => c.split(';')[0]).join('; ')
  userId = up.json?.user?.id ?? null
  if (!step('Neon Auth creates an account', up.status === 200 && !!userId, `HTTP ${up.status}${up.status === 200 ? '' : ` ${up.text.slice(0, 200)}`}`)) throw new Error('sign-up failed')
  if (!step('it starts a session (cookie)', cookie.includes('session_token'), up.setCookie.length ? 'cookies: ' + up.setCookie.map((c) => c.split('=')[0]).join(', ') : 'no Set-Cookie: is "verify email at sign-up" on?')) throw new Error('no session')

  const session = await auth('GET', '/get-session', { cookie })
  let jwt = session.jwt
  step('the session is recognised', session.status === 200 && session.json?.user?.id === userId, `HTTP ${session.status}`)
  if (!jwt) jwt = (await auth('GET', '/token', { cookie })).json?.token ?? null
  if (!step('Neon Auth issues a token', typeof jwt === 'string' && jwt.split('.').length === 3)) throw new Error('no token')

  // One account per email: a second sign-up with the same address must not make another account.
  const dup = await auth('POST', '/sign-up/email', { body: { email: email.toUpperCase(), password, name: 'someone_else' } })
  const refused = dup.status !== 200 || !dup.json?.user?.id || dup.json.user.id === userId
  // (The previous copy of the server doesn't know this route for a few seconds after a deploy.)
  let checked = await api('POST', '/emails/check', null, { email })
  for (let i = 0; i < 12 && checked.status === 404; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    checked = await api('POST', '/emails/check', null, { email })
  }
  const check = checked.json ?? {}
  const free = (await api('POST', '/emails/check', null, { email: `nobody-${tag}@example.com` })).json ?? {}
  step('the same email cannot make a second account', refused, `Neon Auth answered HTTP ${dup.status} ${dup.json?.code ?? ''}`)
  if (check.inUse === true && free.inUse === false) step('the server can tell the sign-up form that an email is already in use', true)
  else console.log(`note  the server cannot read Neon Auth's accounts (emails/check says ${JSON.stringify(check)} / ${JSON.stringify(free)}): the form learns an email is in use from Neon Auth when you press Create account`)

  const me = await api('GET', '/me', jwt)
  if (!step('the Vanity server accepts the token', me.status === 200 && me.json?.user?.id === userId, `HTTP ${me.status} ${me.text.slice(0, 200)}`)) throw new Error('token rejected')
  step('a made-up token is refused', (await api('GET', '/me', jwt.slice(0, -6) + 'AAAAAA')).status === 401)

  const named = await api('PUT', '/me/username', jwt, { username })
  step('a username can be picked (the database works)', named.status === 200 && named.json?.user?.username === username, `HTTP ${named.status} ${named.text.slice(0, 200)}`)
  // Signing in with the username instead of the email goes through the server (new copies only).
  let byName = await api('POST', '/auth/sign-in', null, { username, password })
  for (let i = 0; i < 12 && byName.status === 404; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    byName = await api('POST', '/auth/sign-in', null, { username, password })
  }
  const nameCookie = (byName.json?.setCookie ?? []).map((c) => c.split(';')[0]).join('; ')
  if (step('signing in with the username works', byName.status === 200 && byName.json?.user?.id === userId && nameCookie.includes('session_token'), `HTTP ${byName.status} ${byName.status === 200 ? '' : byName.text.slice(0, 200)}`)) {
    step('that session is a real one', (await auth('GET', '/get-session', { cookie: nameCookie })).json?.user?.id === userId)
    const badName = await api('POST', '/auth/sign-in', null, { username, password: 'definitely-wrong' })
    const noName = await api('POST', '/auth/sign-in', null, { username: `nobody_${tag}`.slice(0, 20), password })
    step('a wrong password and an unknown username get the same answer', badName.status === 401 && noName.status === 401 && badName.text === noName.text, `HTTP ${badName.status} / ${noName.status}`)
    // After a password reset the app ends every other session: check Neon Auth can do that.
    const revoke = await auth('POST', '/revoke-other-sessions', { cookie })
    const other = await auth('GET', '/get-session', { cookie: nameCookie })
    const mine = await auth('GET', '/get-session', { cookie })
    step('other sessions can be signed out, and this one stays', revoke.status === 200 && other.json === null && mine.json?.user?.id === userId, `HTTP ${revoke.status}, other session ${other.json === null ? 'ended' : 'still alive'}`)
  }
  // Right after a deploy, some requests still reach the previous copy of the server for a few
  // seconds. It doesn't know this route yet (404): give the new copy a moment before judging.
  let profile = await api('PUT', '/me/profile', jwt, { bio: 'Deploy check' })
  for (let i = 0; i < 12 && profile.status === 404; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    profile = await api('PUT', '/me/profile', jwt, { bio: 'Deploy check' })
  }
  step('a bio can be saved, and a throwaway account gets no official badge', profile.status === 200 && profile.json?.user?.bio === 'Deploy check' && profile.json?.user?.verified === false && profile.json?.user?.admin === false, `HTTP ${profile.status} ${profile.text.slice(0, 200)}`)
  // The same wait for the profile look, which only the new copy of the server knows.
  let look = await api('PUT', '/me/profile', jwt, { style: { frame: 'gold' } })
  for (let i = 0; i < 12 && look.status === 200 && !look.json?.user?.style; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    look = await api('PUT', '/me/profile', jwt, { style: { frame: 'gold' } })
  }
  step('a profile look can be saved', look.status === 200 && look.json?.user?.style?.frame === 'gold', `HTTP ${look.status} ${look.text.slice(0, 200)}`)
  step('a look that is not on the list is refused', (await api('PUT', '/me/profile', jwt, { style: { banner: 'url(x)' } })).status === 400)
  // The app's once-a-minute check-in brings the account's badges back (the new copy of the server only).
  let beat = await api('PUT', '/presence', jwt, { gameKey: null })
  for (let i = 0; i < 12 && beat.status === 204; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    beat = await api('PUT', '/presence', jwt, { gameKey: null })
  }
  step('checking in answers with the badges (none for a throwaway account)', beat.status === 200 && beat.json?.verified === false && beat.json?.admin === false, `HTTP ${beat.status} ${beat.text.slice(0, 120)}`)
  step('friends list loads', (await api('GET', '/friends', jwt)).status === 200)
  const synced = await api('POST', '/sync', jwt, {
    deviceId: `smoke-${tag}`,
    deviceName: 'Deploy check',
    games: [{ key: 'g:smoke-test', name: 'Smoke Test', playtimeSeconds: 120, launches: 2, lastPlayedAt: Date.now(), firstPlayedAt: Date.now() }],
    prefs: [{ key: 'g:smoke-test', favorite: true, playStatus: 'playing', userRating: 5, notes: null, updatedAt: Date.now() - 1000 }],
    days: [new Date().toISOString().slice(0, 10)],
    badges: { 'first-launch': Date.now() },
    collections: { updatedAt: Date.now() - 1000, items: [{ name: 'Smoke', games: ['g:smoke-test'] }] },
    settings: { updatedAt: Date.now() - 1000, values: { theme: 'default' } },
    summary: { xp: 37, level: 1 }
  })
  step(
    'cloud sync saves and returns progress',
    synced.status === 200 && synced.json?.games?.[0]?.playtimeSeconds === 120 && synced.json?.prefs?.[0]?.favorite === true && synced.json?.days?.length === 1 && synced.json?.collections?.items?.length === 1,
    `HTTP ${synced.status} ${synced.status === 200 ? '' : synced.text.slice(0, 200)}`
  )
  // Steam: only checked when the server has a key. A well-known public profile is looked up.
  const steamLink = await api('GET', '/steam/link', jwt)
  if (steamLink.status !== 200) {
    step('Steam routes answer', false, `HTTP ${steamLink.status} ${steamLink.text.slice(0, 200)}`)
  } else if (!steamLink.json?.configured) {
    console.log('note  Steam linking is off: the server has no Steam key yet (add the STEAM_WEB_API_KEY repository secret and deploy again)')
  } else {
    // Right after a deploy, some requests can still reach the previous copy of the server (without
    // the key) for a few seconds: give the new one a moment before judging.
    let looked = await api('POST', '/steam/resolve', jwt, { input: '76561197960287930' })
    for (let i = 0; i < 12 && looked.json?.code === 'steam_not_configured'; i++) {
      await new Promise((r) => setTimeout(r, 5000))
      looked = await api('POST', '/steam/resolve', jwt, { input: '76561197960287930' })
    }
    step('the Steam key works (looked up a public Steam profile)', looked.status === 200 && looked.json?.profile?.steamId === '76561197960287930', `HTTP ${looked.status} ${looked.status === 200 ? looked.json?.profile?.name : (looked.json?.code ?? looked.text.slice(0, 120))}`)
    const noLink = await api('GET', '/steam/owned-games', jwt)
    step('Steam games need a linked account', noLink.status === 409 && noLink.json?.code === 'steam_not_linked', `HTTP ${noLink.status}`)
  }
  step('the Vanity profile is removed again', (await api('DELETE', '/me', jwt)).status === 204)

  const wrong = await auth('POST', '/sign-in/email', { body: { email, password: 'definitely-wrong' } })
  step('a wrong password is refused', wrong.status === 401, `HTTP ${wrong.status} ${wrong.json?.code ?? ''}`)
  const again = await auth('POST', '/sign-in/email', { body: { email, password } })
  step('signing in again works', again.status === 200)
  const out = await auth('POST', '/sign-out', { cookie })
  step('signing out ends the session', out.status === 200 && (await auth('GET', '/get-session', { cookie })).json === null)
} catch (err) {
  step('finished', false, err instanceof Error ? err.message : String(err))
}

console.log(failed ? '\nSome checks failed.' : '\nAll checks passed.')
if (userId) console.log(`user-id: ${userId}`)
process.exit(failed ? 1 : 0)
