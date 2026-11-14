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

  const me = await api('GET', '/me', jwt)
  if (!step('the Vanity server accepts the token', me.status === 200 && me.json?.user?.id === userId, `HTTP ${me.status} ${me.text.slice(0, 200)}`)) throw new Error('token rejected')
  step('a made-up token is refused', (await api('GET', '/me', jwt.slice(0, -6) + 'AAAAAA')).status === 401)

  const named = await api('PUT', '/me/username', jwt, { username })
  step('a username can be picked (the database works)', named.status === 200 && named.json?.user?.username === username, `HTTP ${named.status} ${named.text.slice(0, 200)}`)
  step('friends list loads', (await api('GET', '/friends', jwt)).status === 200)
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
