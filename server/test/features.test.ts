// Coins (Stripe), username changes, comments, calls and the admin tools, on a real Postgres (PGlite).
import { createHmac } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp, USERNAME_COOLDOWN_MS } from '../src/app'
import { COIN_BUNDLES, SHOP_ITEMS } from '../src/coinBundles'
import { validStripeSignature } from '../src/coins'
import type { Sql } from '../src/db'
import { ADMIN_USERNAMES, OWNER_USERNAMES } from '../src/roles'
import { schemaStatements } from '../src/schema'
import { maskProfanity, usernameProblem } from '../src/words'
import { dmChat as sharedDmChat, RING_MS as SHARED_RING_MS } from '../../src/shared/voiceProtocol'
import { dmChat } from '../src/voice'
import { RING_MS } from '../src/app'

const WHSEC = 'whsec_test_secret'
let app: ReturnType<typeof createApp>
let db: PGlite
let clock = 0
/** What the pretend Stripe was asked to make. */
let stripeCalls: URLSearchParams[] = []
let sessionN = 0

async function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', host: 'vanity.test', 'x-forwarded-proto': 'https', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, json }
}
async function register(username: string): Promise<{ token: string; id: string }> {
  const id = `id-${username.toLowerCase()}`
  expect((await call('PUT', '/me/username', `t:${id}`, { username })).status).toBe(200)
  return { token: `t:${id}`, id }
}
async function befriend(a: { token: string; id: string }, b: { token: string; id: string }, bName: string): Promise<void> {
  await call('POST', '/friends/requests', a.token, { username: bName })
  await call('POST', `/friends/requests/${a.id}/accept`, b.token)
}
async function admin(): Promise<{ token: string; id: string }> {
  ADMIN_USERNAMES.push('TestBoss')
  try {
    return await register('TestBoss')
  } finally {
    ADMIN_USERNAMES.pop()
  }
}
/** A message from Stripe, signed the way Stripe signs them. */
async function stripeEvent(type: string, object: Record<string, unknown>, opts: { id?: string; secret?: string; at?: number } = {}): Promise<{ status: number; json: any }> {
  const payload = JSON.stringify({ id: opts.id ?? `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } })
  const t = Math.floor((opts.at ?? Date.now() + clock) / 1000)
  const sig = createHmac('sha256', opts.secret ?? WHSEC).update(`${t}.${payload}`).digest('hex')
  const res = await app.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json' }, body: payload })
  return { status: res.status, json: await res.json() }
}
const balance = async (token: string): Promise<number> => (await call('GET', '/coins', token)).json.balance
/** Starts a checkout for a bundle and answers with its session id. */
async function checkout(token: string, bundleId: string): Promise<string> {
  const r = await call('POST', '/coins/checkout', token, { bundleId })
  expect(r.status).toBe(200)
  return new URL(r.json.url).pathname.split('/').pop()!
}

beforeEach(async () => {
  db = new PGlite()
  clock = 0
  stripeCalls = []
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return (await db.query(text, values)).rows as never
  }
  app = createApp({
    sql,
    verifyToken: async (token) => (token.startsWith('t:') ? { id: token.slice(2), email: `${token.slice(2)}@example.com` } : null),
    migrate: async () => {
      for (const statement of schemaStatements()) await db.query(statement)
    },
    lookupRateLimit: 100_000,
    now: () => Date.now() + clock,
    stripe: { secretKey: 'sk_test_123', webhookSecret: WHSEC },
    fetchFn: (async (url: string, init?: RequestInit) => {
      if (!String(url).startsWith('https://api.stripe.com/v1/checkout/sessions')) throw new Error(`unexpected request to ${url}`)
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer sk_test_123')
      stripeCalls.push(new URLSearchParams(String(init?.body)))
      const id = `cs_test_${++sessionN}`
      return new Response(JSON.stringify({ id, url: `https://checkout.stripe.com/c/pay/${id}` }), { status: 200 })
    }) as never
  })
})

describe('Vanity Coins', () => {
  const B = COIN_BUNDLES[1]

  it('sells the bundles from the config file and credits only when Stripe says it was paid', async () => {
    const a = await register('alice')
    const store = (await call('GET', '/coins', a.token)).json
    expect(store).toMatchObject({ balance: 0, purchasesEnabled: true, bundles: COIN_BUNDLES, owned: [] })
    expect(store.items).toContainEqual({ id: 'frame:diamond', ...SHOP_ITEMS['frame:diamond'] })

    const session = await checkout(a.token, B.id)
    // What Stripe was asked for comes from the server's own list; the app only named the bundle.
    const asked = stripeCalls[0]
    expect(asked.get('line_items[0][price_data][unit_amount]')).toBe(String(B.priceCents))
    expect(asked.get('metadata[user_id]')).toBe(a.id)
    expect(asked.get('success_url')).toBe('https://vanity.test/coins/done')
    expect(await balance(a.token)).toBe(0) // opening the payment page gives nothing

    // Not paid yet, a forged message, a wrong secret, an old message: nothing.
    await stripeEvent('checkout.session.completed', { id: session, payment_status: 'unpaid', amount_total: B.priceCents, currency: 'usd' })
    expect((await stripeEvent('checkout.session.completed', { id: session, payment_status: 'paid', amount_total: B.priceCents, currency: 'usd' }, { secret: 'whsec_wrong' })).status).toBe(400)
    expect((await stripeEvent('checkout.session.completed', { id: session, payment_status: 'paid', amount_total: B.priceCents, currency: 'usd' }, { at: Date.now() - 3_600_000 })).status).toBe(400)
    expect((await app.request('/stripe/webhook', { method: 'POST', body: '{}' })).status).toBe(400)
    // Paid, but for less than was asked: nothing.
    await stripeEvent('checkout.session.completed', { id: session, payment_status: 'paid', amount_total: 1, currency: 'usd', payment_intent: 'pi_1' })
    // A session this server never made: nothing.
    await stripeEvent('checkout.session.completed', { id: 'cs_made_up', payment_status: 'paid', amount_total: B.priceCents, currency: 'usd', metadata: { user_id: a.id, bundle_id: B.id } })
    expect(await balance(a.token)).toBe(0)

    const paid = { id: session, payment_status: 'paid', amount_total: B.priceCents, currency: 'usd', payment_intent: 'pi_1' }
    expect((await stripeEvent('checkout.session.completed', paid, { id: 'evt_paid' })).json).toEqual({ received: true })
    expect(await balance(a.token)).toBe(B.coins)
    // The same event again, and the same payment under a new event id: still counted once.
    expect((await stripeEvent('checkout.session.completed', paid, { id: 'evt_paid' })).json).toEqual({ received: true, duplicate: true })
    await stripeEvent('checkout.session.completed', paid, { id: 'evt_other' })
    await stripeEvent('checkout.session.async_payment_succeeded', paid)
    expect(await balance(a.token)).toBe(B.coins)
    // The quick check-in carries the new balance, so the app shows it without a restart.
    expect((await call('GET', '/pulse', a.token)).json.coins).toBe(B.coins)

    const history = (await call('GET', '/coins/history', a.token)).json
    expect(history.entries).toHaveLength(1)
    expect(history.entries[0]).toMatchObject({ kind: 'purchase', amount: B.coins, paidCents: B.priceCents, currency: 'usd', status: 'paid' })
    // The wallet is exactly the sum of the ledger.
    const { rows } = await db.query<{ sum: number; balance: number }>("SELECT (SELECT SUM(amount)::int FROM vanity.coin_ledger WHERE user_id = 'id-alice') AS sum, (SELECT balance FROM vanity.coin_wallets WHERE user_id = 'id-alice') AS balance")
    expect(rows[0].sum).toBe(rows[0].balance)
  })

  it('refuses unknown bundles and anything the app makes up', async () => {
    const a = await register('alice')
    expect((await call('POST', '/coins/checkout', a.token, { bundleId: 'coins-999999' })).status).toBe(400)
    expect((await call('POST', '/coins/checkout', a.token, { bundleId: B.id, coins: 1_000_000, priceCents: 1 })).status).toBe(200)
    expect(stripeCalls[0].get('line_items[0][price_data][unit_amount]')).toBe(String(B.priceCents))
    expect((await call('POST', '/coins/checkout')).status).toBe(401)
    // No route lets an account write to its own ledger.
    for (const path of ['/coins/grant', '/coins/ledger', '/coins']) expect((await call('POST', path, a.token, { amount: 5000 })).status).toBe(404)
  })

  it('takes coins back for refunds and chargebacks, and returns them when a dispute is won', async () => {
    const a = await register('alice')
    const session = await checkout(a.token, B.id)
    await stripeEvent('checkout.session.completed', { id: session, payment_status: 'paid', amount_total: B.priceCents, currency: 'usd', payment_intent: 'pi_7' })

    // Half the money back: half the coins. The same message twice counts once.
    const half = { id: 'ch_1', payment_intent: 'pi_7', amount: B.priceCents, amount_refunded: Math.round(B.priceCents / 2) }
    await stripeEvent('charge.refunded', half)
    await stripeEvent('charge.refunded', half)
    expect(await balance(a.token)).toBe(B.coins - Math.round((B.coins * half.amount_refunded) / B.priceCents))
    // The rest back: nothing left of it.
    await stripeEvent('charge.refunded', { ...half, amount_refunded: B.priceCents })
    expect(await balance(a.token)).toBe(0)

    // A second purchase is spent, then charged back: the balance goes below zero.
    const s2 = await checkout(a.token, COIN_BUNDLES[0].id)
    await stripeEvent('checkout.session.completed', { id: s2, payment_status: 'paid', amount_total: COIN_BUNDLES[0].priceCents, currency: 'usd', payment_intent: 'pi_8' })
    expect((await call('POST', '/coins/buy', a.token, { itemId: 'frame:diamond' })).json.balance).toBe(COIN_BUNDLES[0].coins - 400)
    await stripeEvent('charge.dispute.created', { id: 'dp_1', payment_intent: 'pi_8', status: 'needs_response' })
    await stripeEvent('charge.dispute.created', { id: 'dp_1', payment_intent: 'pi_8', status: 'needs_response' })
    expect(await balance(a.token)).toBe(-400)
    expect((await call('POST', '/coins/buy', a.token, { itemId: 'title:Legend' })).status).toBe(402)
    await stripeEvent('charge.dispute.closed', { id: 'dp_1', payment_intent: 'pi_8', status: 'lost' })
    expect(await balance(a.token)).toBe(-400)
    await stripeEvent('charge.dispute.closed', { id: 'dp_1', payment_intent: 'pi_8', status: 'won' })
    await stripeEvent('charge.dispute.closed', { id: 'dp_1', payment_intent: 'pi_8', status: 'won' })
    expect(await balance(a.token)).toBe(COIN_BUNDLES[0].coins - 400)
    expect((await call('GET', '/coins/history', a.token)).json.entries.map((e: { kind: string }) => e.kind)).toEqual(['reversal', 'chargeback', 'spend', 'purchase', 'refund', 'refund', 'purchase'])
  })

  it('spends coins on premium looks: once, only with enough, and never twice at the same moment', async () => {
    const a = await register('alice')
    // A premium look can't be worn before it is bought; the free ones always can.
    const locked = await call('PUT', '/me/profile', a.token, { style: { frame: 'diamond' } })
    expect([locked.status, locked.json.code]).toEqual([402, 'look_locked'])
    expect((await call('PUT', '/me/profile', a.token, { style: { frame: 'gold' } })).status).toBe(200)
    expect((await call('POST', '/coins/buy', a.token, { itemId: 'frame:diamond' })).json.code).toBe('not_enough_coins')
    expect((await call('POST', '/coins/buy', a.token, { itemId: 'frame:gold' })).status).toBe(400)

    const session = await checkout(a.token, COIN_BUNDLES[0].id) // 500 coins
    await stripeEvent('checkout.session.completed', { id: session, payment_status: 'paid', amount_total: COIN_BUNDLES[0].priceCents, currency: 'usd', payment_intent: 'pi_2' })
    // Two things that together cost more than the balance, asked for at the same moment: one wins.
    const both = await Promise.all([call('POST', '/coins/buy', a.token, { itemId: 'frame:diamond' }), call('POST', '/coins/buy', a.token, { itemId: 'frame:inferno' })])
    expect(both.map((r) => r.status).sort()).toEqual([200, 402])
    expect(await balance(a.token)).toBe(100)
    const owned = (await call('GET', '/coins', a.token)).json.owned
    expect(owned).toHaveLength(1)
    const [part, look] = owned[0].split(':')
    expect((await call('POST', '/coins/buy', a.token, { itemId: owned[0] })).status).toBe(409) // already owned
    expect((await call('PUT', '/me/profile', a.token, { style: { [part]: look } })).json.user.style[part]).toBe(look)
    expect(await balance(a.token)).toBe(100)
  })

  it('says buying is not set up when the server has no Stripe keys', async () => {
    const plain = new PGlite()
    const sql: Sql = async (strings, ...values) => (await plain.query(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values)).rows as never
    app = createApp({ sql, verifyToken: async (t) => ({ id: t.slice(2), email: null }), migrate: async () => { for (const st of schemaStatements()) await plain.query(st) } })
    const a = await register('alice')
    expect((await call('GET', '/coins', a.token)).json.purchasesEnabled).toBe(false)
    expect((await call('POST', '/coins/checkout', a.token, { bundleId: B.id })).json.code).toBe('purchases_off')
    expect((await app.request('/stripe/webhook', { method: 'POST', body: '{}' })).status).toBe(503)
  })

  it('checks Stripe signatures exactly', () => {
    const body = '{"id":"evt_1"}'
    const t = 1_700_000_000
    const good = createHmac('sha256', WHSEC).update(`${t}.${body}`).digest('hex')
    expect(validStripeSignature(body, `t=${t},v1=${good}`, WHSEC, t * 1000)).toBe(true)
    expect(validStripeSignature(body, `t=${t},v1=bad,v1=${good}`, WHSEC, t * 1000)).toBe(true) // a rotated secret
    expect(validStripeSignature(body + ' ', `t=${t},v1=${good}`, WHSEC, t * 1000)).toBe(false)
    expect(validStripeSignature(body, `t=${t},v1=${good}`, WHSEC, (t + 600) * 1000)).toBe(false)
    expect(validStripeSignature(body, `t=${t},v1=${good}`, '', t * 1000)).toBe(false)
    for (const h of [undefined, '', 'v1=' + good, `t=${t}`, 'garbage']) expect(validStripeSignature(body, h, WHSEC, t * 1000)).toBe(false)
  })
})

describe('changing your username', () => {
  it('follows the account everywhere, once every 30 days, and keeps the history', async () => {
    const a = await register('alice')
    const b = await register('bob')
    await befriend(a, b, 'bob')
    await call('POST', `/friends/${b.id}/messages`, a.token, { text: 'hello from alice' })
    const g = (await call('POST', '/groups', a.token, { name: 'Squad', memberIds: [b.id] })).json.group
    await call('POST', `/groups/${g.id}/messages`, a.token, { text: 'in the group' })
    await call('POST', '/games/g:portal-2/comments', a.token, { text: 'Great game' })
    await call('POST', '/voice/call', a.token, { friendId: b.id })

    const renamed = await call('PUT', '/me/username', a.token, { username: 'Alicia' })
    expect(renamed.json.user).toMatchObject({ username: 'Alicia' })
    expect(renamed.json.user.usernameChangeAt).toBeGreaterThan(Date.now() + USERNAME_COOLDOWN_MS - 60_000)
    // Bob sees the new name in his friends list, the old messages, the group, the comment and the call.
    expect((await call('GET', '/friends', b.token)).json.friends[0].username).toBe('Alicia')
    expect((await call('GET', '/groups', b.token)).json.groups[0].members.map((m: { username: string }) => m.username).sort()).toEqual(['Alicia', 'bob'])
    expect((await call('GET', '/games/g:portal-2/comments', b.token)).json.comments[0].user.username).toBe('Alicia')
    expect((await call('GET', '/pulse', b.token)).json.calls[0].from.username).toBe('Alicia')
    expect((await call('GET', '/pulse', a.token)).json.username).toBe('Alicia')
    // The old name is free again; the messages still belong to the same account.
    expect((await call('GET', '/usernames/alice')).json).toEqual({ available: true })
    expect((await call('GET', `/friends/${a.id}/messages`, b.token)).json.messages[0].text).toBe('hello from alice')

    // Not again for 30 days (changing only the capitals is always fine).
    const again = await call('PUT', '/me/username', a.token, { username: 'alice2' })
    expect([again.status, again.json.code]).toEqual([429, 'username_cooldown'])
    expect((await call('PUT', '/me/username', a.token, { username: 'ALICIA' })).json.user.username).toBe('ALICIA')
    clock += USERNAME_COOLDOWN_MS + 60_000
    expect((await call('PUT', '/me/username', a.token, { username: 'alice2' })).json.user.username).toBe('alice2')
    const { rows } = await db.query<{ old_username: string | null; new_username: string }>("SELECT old_username, new_username FROM vanity.username_history WHERE user_id = 'id-alice' ORDER BY id")
    expect(rows).toEqual([{ old_username: null, new_username: 'alice' }, { old_username: 'alice', new_username: 'Alicia' }, { old_username: 'Alicia', new_username: 'ALICIA' }, { old_username: 'ALICIA', new_username: 'alice2' }])
  })

  it('refuses taken, reserved and rude names', async () => {
    const a = await register('alice')
    await register('bob')
    expect((await call('PUT', '/me/username', a.token, { username: 'BOB' })).status).toBe(409)
    for (const name of ['admin', 'Vanity', 'Moderator', 'sh1t_head', 'xXfuckXx', 'n1gger', 'a_fag_b']) expect([name, (await call('PUT', '/me/username', a.token, { username: name })).status]).toEqual([name, 400])
    expect((await call('PUT', '/me/username', 't:new1', { username: 'Hitler' })).status).toBe(400) // at sign-up too
    // Innocent names that only contain a short blocked word pass.
    expect(usernameProblem('classic_gamer')).toBeNull()
    expect(usernameProblem('peacock_grape')).toBeNull()
    expect(usernameProblem('cucumber')).toBeNull()
    expect((await call('GET', '/me', a.token)).json.user.username).toBe('alice')
  })

  it("can't be used to take an official badge: a name on the list waits for its owner", async () => {
    const a = await register('alice')
    ADMIN_USERNAMES.push('BigBoss')
    try {
      // Nobody has claimed it: an existing account can't rename itself into it.
      expect((await call('PUT', '/me/username', a.token, { username: 'bigboss' })).status).toBe(409)
      const boss = await register('BigBoss')
      expect((await call('GET', '/me', boss.token)).json.user.admin).toBe(true)
      // The owner renames; the badge goes with them, and the old name gives nothing to whoever takes it.
      expect((await call('PUT', '/me/username', boss.token, { username: 'boss_two' })).json.user).toMatchObject({ username: 'boss_two', admin: true })
      expect((await call('PUT', '/me/username', 't:thief', { username: 'BigBoss' })).status).toBe(200)
      expect((await call('GET', '/me', 't:thief')).json.user.admin).toBe(false)
      expect((await call('GET', '/admin/overview', 't:thief')).status).toBe(403)
    } finally {
      ADMIN_USERNAMES.pop()
    }
  })
})

describe('game comments', () => {
  it('posts, lists newest first in pages, edits, deletes and hides bad words', async () => {
    const a = await register('alice')
    const b = await register('bob')
    for (let i = 1; i <= 23; i++) {
      clock += 61_000
      expect((await call('POST', '/games/g:hades/comments', i % 2 ? a.token : b.token, { text: `Comment ${i}` })).status).toBe(201)
    }
    const first = (await call('GET', '/games/g:hades/comments', b.token)).json
    expect(first).toMatchObject({ hasMore: true, total: 23 })
    expect(first.comments.map((c: { text: string }) => c.text).slice(0, 2)).toEqual(['Comment 23', 'Comment 22'])
    expect(first.comments[0]).toMatchObject({ user: { username: 'alice', verified: false }, mine: false, editedAt: null })
    const older = (await call('GET', `/games/g:hades/comments?before=${first.comments.at(-1).id}`, b.token)).json
    expect(older.comments.map((c: { text: string }) => c.text)).toEqual(['Comment 3', 'Comment 2', 'Comment 1'])
    expect(older.hasMore).toBe(false)
    // Another game has its own thread.
    expect((await call('GET', '/games/g:portal-2/comments', b.token)).json.total).toBe(0)

    const mine = first.comments[0].id
    expect((await call('PATCH', `/comments/${mine}`, b.token, { text: 'hacked' })).status).toBe(403)
    expect((await call('DELETE', `/comments/${mine}`, b.token)).status).toBe(403)
    const edited = (await call('PATCH', `/comments/${mine}`, a.token, { text: '  What the FUCK is this sh1t,\n\n\n\nclassic  ' })).json.comment
    expect(edited.text).toBe('What the **** is this ****,\n\nclassic')
    expect(edited.editedAt).toBeGreaterThan(0)
    expect((await call('DELETE', `/comments/${mine}`, a.token)).status).toBe(204)
    expect((await call('GET', '/games/g:hades/comments', b.token)).json.total).toBe(22)
    expect((await call('POST', '/games/g:hades/comments', a.token, { text: '   ' })).status).toBe(400)
    expect((await call('POST', '/games/g:hades/comments', a.token, { text: 'x'.repeat(1001) })).status).toBe(400)
    expect((await call('POST', '/games/not-a-key/comments', a.token, { text: 'hi' })).status).toBe(400)
    expect(maskProfanity('assassin class, Scunthorpe')).toBe('assassin class, Scunthorpe')
  })

  it('stops spam: a few a minute, no repeats', async () => {
    const a = await register('alice')
    const post = async (text: string): Promise<number> => (await call('POST', '/games/g:hades/comments', a.token, { text })).status
    expect([await post('one'), await post('one'), await post('two'), await post('three'), await post('four'), await post('five')]).toEqual([201, 409, 201, 201, 201, 429])
    clock += 61_000
    expect(await post('five')).toBe(201)
  })

  it('lets people report a comment, and admins keep or remove it', async () => {
    const boss = await admin()
    const a = await register('alice')
    const b = await register('bob')
    const id = (await call('POST', '/games/g:hades/comments', a.token, { text: 'buy cheap coins at example dot com' })).json.comment.id
    expect((await call('POST', `/comments/${id}/report`, a.token, {})).status).toBe(400) // your own
    expect((await call('POST', `/comments/${id}/report`, b.token, { reason: 'spam' })).status).toBe(204)
    expect((await call('POST', `/comments/${id}/report`, b.token, { reason: 'spam again' })).status).toBe(204) // once per person
    expect((await call('GET', '/admin/reports', b.token)).status).toBe(403)
    const reports = (await call('GET', '/admin/reports', boss.token)).json.reports
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ commentId: id, reports: 1, reasons: ['spam'], user: { username: 'alice' }, gameKey: 'g:hades' })
    expect((await call('GET', '/admin/overview', boss.token)).json.reports).toBe(1)
    // Kept: the report is closed, the comment stays.
    await call('POST', `/admin/reports/${id}`, boss.token, { remove: false })
    expect((await call('GET', '/admin/reports', boss.token)).json.reports).toHaveLength(0)
    expect((await call('GET', '/games/g:hades/comments', b.token)).json.total).toBe(1)
    // Removed.
    await call('POST', `/admin/reports/${id}`, boss.token, { remove: true })
    expect((await call('GET', '/games/g:hades/comments', b.token)).json.total).toBe(0)
  })
})

describe('calls from chats', () => {
  it('rings a friend, who answers; whoever is in the chat can come back any time', async () => {
    expect(dmChat('b', 'a')).toBe(sharedDmChat('a', 'b'))
    expect(RING_MS).toBe(SHARED_RING_MS)
    const a = await register('alice')
    const b = await register('bob')
    const c = await register('cal')
    await befriend(a, b, 'bob')
    expect((await call('POST', '/voice/call', a.token, { friendId: c.id })).status).toBe(403) // not a friend

    const started = (await call('POST', '/voice/call', a.token, { friendId: b.id })).json
    expect(started.room).toMatchObject({ chat: dmChat(a.id, b.id), private: true })
    expect(started.room.ringing.map((r: { username: string }) => r.username)).toEqual(['bob'])
    const ring = (await call('GET', '/pulse', b.token)).json.calls
    expect(ring).toHaveLength(1)
    expect(ring[0]).toMatchObject({ roomId: started.room.id, from: { username: 'alice' }, group: null })
    expect((await call('GET', '/pulse', c.token)).json.calls).toEqual([])
    // It isn't in anyone's friends list as a room to wander into.
    expect((await call('POST', `/voice/rooms/${started.room.id}/join`, c.token)).status).toBe(403)

    const joined = (await call('POST', `/voice/rooms/${started.room.id}/join`, b.token)).json
    expect(joined.room.members.map((m: { user: { username: string } }) => m.user.username)).toEqual(['alice', 'bob'])
    expect(joined.room.ringing).toEqual([])
    expect((await call('GET', '/pulse', b.token)).json.calls).toEqual([])
    // Bob drops out and calls back: the same call, no second room.
    await call('POST', '/voice/leave', b.token)
    expect((await call('POST', '/voice/call', b.token, { friendId: a.id })).json.room.id).toBe(started.room.id)
  })

  it('declines, and stops ringing by itself', async () => {
    const a = await register('alice')
    const b = await register('bob')
    await befriend(a, b, 'bob')
    const room = (await call('POST', '/voice/call', a.token, { friendId: b.id })).json.room
    expect((await call('POST', `/voice/rings/${room.id}/decline`, b.token)).status).toBe(204)
    expect((await call('GET', '/pulse', b.token)).json.calls).toEqual([])
    expect((await call('GET', '/voice/update', a.token)).json.room.ringing).toEqual([])
    // Calling again rings again; unanswered, it gives up after 40 seconds.
    await call('POST', '/voice/call', a.token, { friendId: b.id })
    expect((await call('GET', '/pulse', b.token)).json.calls).toHaveLength(1)
    clock += RING_MS + 1000
    expect((await call('GET', '/pulse', b.token)).json.calls).toEqual([])
    // The caller hangs up: the call is over.
    await call('POST', '/voice/leave', a.token)
    expect((await call('GET', '/voice/update', a.token)).json.room).toBeNull()
  })

  it('calls a group chat: everyone else rings, with the group named', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const c = await register('cal')
    const d = await register('dee')
    await befriend(a, b, 'bob')
    await befriend(a, c, 'cal')
    const g = (await call('POST', '/groups', a.token, { name: 'Raid night', memberIds: [b.id, c.id] })).json.group
    expect((await call('POST', '/voice/call', d.token, { groupId: g.id })).status).toBe(404)
    const room = (await call('POST', '/voice/call', a.token, { groupId: g.id })).json.room
    expect(room.chat).toBe(`group:${g.id}`)
    expect(room.ringing.map((r: { username: string }) => r.username)).toEqual(['bob', 'cal'])
    expect((await call('GET', '/pulse', c.token)).json.calls[0]).toMatchObject({ from: { username: 'alice' }, group: { id: g.id, name: 'Raid night' } })
    await call('POST', `/voice/rooms/${room.id}/join`, b.token)
    // Cal joins from the chat's call button instead of the ring: the same call.
    expect((await call('POST', '/voice/call', c.token, { groupId: g.id })).json.room.members).toHaveLength(3)
    expect((await call('POST', `/voice/rooms/${room.id}/join`, d.token)).status).toBe(403)
  })

  it('shows who is watching whose screen', async () => {
    const a = await register('alice')
    const b = await register('bob')
    await befriend(a, b, 'bob')
    const room = (await call('POST', '/voice/call', a.token, { friendId: b.id })).json.room
    await call('POST', `/voice/rooms/${room.id}/join`, b.token)
    const watching = async (): Promise<Record<string, string | null>> => Object.fromEntries((await call('GET', '/voice/update', a.token)).json.room.members.map((m: { user: { username: string }; watching: string | null }) => [m.user.username, m.watching]))
    // Watching someone who isn't sharing doesn't count.
    await call('POST', '/voice/state', b.token, { muted: false, deafened: false, sharing: false, camera: false, streams: {}, watching: a.id })
    expect(await watching()).toEqual({ alice: null, bob: null })
    await call('POST', '/voice/state', a.token, { muted: false, deafened: false, sharing: true, camera: false, streams: { screen: 's1' } })
    expect(await watching()).toEqual({ alice: null, bob: a.id })
    await call('POST', '/voice/state', b.token, { muted: false, deafened: false, sharing: false, camera: false, streams: {}, watching: null })
    expect(await watching()).toEqual({ alice: null, bob: null })
  })
})

describe('admin tools', () => {
  it('are for admins only', async () => {
    const a = await register('alice')
    for (const [m, p] of [['GET', '/admin/overview'], ['GET', '/admin/users'], ['GET', `/admin/users/${a.id}`], ['POST', `/admin/users/${a.id}/coins`], ['POST', `/admin/users/${a.id}/ban`], ['POST', `/admin/users/${a.id}/roles`], ['DELETE', `/admin/users/${a.id}`], ['GET', '/admin/log']] as const) {
      expect([p, (await call(m, p, a.token, m === 'GET' ? undefined : { amount: 999, admin: true })).status]).toEqual([p, 403])
      expect((await call(m, p)).status).toBe(401)
    }
    expect(await balance(a.token)).toBe(0)
  })

  it('lists and searches every account, and shows one in full', async () => {
    const boss = await admin()
    const a = await register('alice')
    await register('bob')
    await call('PUT', '/presence', a.token, { gameKey: 'g:hades', gameName: 'Hades', startedAt: Date.now() })
    const all = (await call('GET', '/admin/users', boss.token)).json
    expect(all.total).toBe(3)
    expect(all.users.map((u: { username: string }) => u.username).sort()).toEqual(['TestBoss', 'alice', 'bob'])
    expect(all.users.find((u: { username: string }) => u.username === 'alice')).toMatchObject({ online: true, playing: 'Hades', coins: 0, standing: { banned: false } })
    expect((await call('GET', '/admin/users?q=ALI', boss.token)).json.users.map((u: { username: string }) => u.username)).toEqual(['alice'])
    expect((await call('GET', `/admin/users?q=${a.id}`, boss.token)).json.users).toHaveLength(1)
    expect((await call('GET', '/admin/users?filter=staff', boss.token)).json.users.map((u: { username: string }) => u.username)).toEqual(['TestBoss'])
    expect((await call('GET', '/admin/users?filter=online', boss.token)).json.users.map((u: { username: string }) => u.username)).toEqual(['alice'])
    // Found by a name they used to have.
    clock += 1000
    await call('PUT', '/me/username', a.token, { username: 'alicia' })
    expect((await call('GET', '/admin/users?q=alice', boss.token)).json.users.map((u: { username: string }) => u.username)).toEqual(['alicia'])
    const one = (await call('GET', `/admin/users/${a.id}`, boss.token)).json
    expect(one.user).toMatchObject({ username: 'alicia', email: null })
    expect(one.usernames.map((u: { to: string }) => u.to)).toEqual(['alicia', 'alice'])
    expect((await call('GET', '/admin/overview', boss.token)).json).toMatchObject({ users: 3, online: 1, banned: 0, unclaimedBadgeNames: expect.any(Array) })
  })

  it('adds coins to any account, usable at once and seen without a restart', async () => {
    const boss = await admin()
    const a = await register('alice')
    expect((await call('POST', `/admin/users/${a.id}/coins`, boss.token, { amount: 1000, note: 'Tournament prize' })).json).toEqual({ balance: 1000 })
    expect((await call('GET', '/pulse', a.token)).json.coins).toBe(1000) // the app's next check-in
    expect((await call('POST', '/coins/buy', a.token, { itemId: 'aura:vortex' })).json.balance).toBe(400)
    expect((await call('POST', `/admin/users/${a.id}/coins`, boss.token, { amount: -150 })).json).toEqual({ balance: 250 })
    for (const amount of [0, 'lots', 5_000_000, null]) expect((await call('POST', `/admin/users/${a.id}/coins`, boss.token, { amount })).status).toBe(400)
    const entries = (await call('GET', '/coins/history', a.token)).json.entries
    expect(entries.map((e: { kind: string; amount: number; note: string }) => [e.kind, e.amount, e.note])).toEqual([['admin', -150, 'Removed by TestBoss'], ['spend', -600, 'Vortex aura'], ['admin', 1000, 'Tournament prize']])
    expect((await call('GET', '/admin/log', boss.token)).json.log.map((l: { action: string; detail: string; target: string }) => [l.action, l.target, l.detail])).toEqual([['coins', 'alice', '-150'], ['coins', 'alice', '+1000: Tournament prize']])
  })

  it('bans (the account is shut out, and told why) and unbans', async () => {
    const boss = await admin()
    const a = await register('alice')
    const b = await register('bob')
    await befriend(a, b, 'bob')
    await call('POST', '/voice/rooms', a.token, {})
    expect((await call('POST', `/admin/users/${boss.id}/ban`, boss.token, {})).status).toBe(400) // not yourself
    expect((await call('POST', `/admin/users/${a.id}/ban`, boss.token, { reason: 'Cheating' })).status).toBe(204)
    const refused = await call('GET', '/friends', a.token)
    expect([refused.status, refused.json.code, refused.json.error]).toEqual([403, 'banned', 'This account has been banned: Cheating'])
    expect((await call('POST', `/friends/${b.id}/messages`, a.token, { text: 'hi' })).status).toBe(403)
    expect((await call('PUT', '/me/username', a.token, { username: 'new_me' })).status).toBe(403)
    // The app can still find out what happened.
    expect((await call('GET', '/pulse', a.token)).json.standing).toEqual({ banned: true, reason: 'Cheating', timeoutUntil: null })
    expect((await call('GET', '/me', a.token)).json.user.standing.banned).toBe(true)
    // Out of voice and shown offline to friends.
    expect((await call('GET', '/friends', b.token)).json.friends[0]).toMatchObject({ status: { state: 'offline' }, voice: null })
    expect((await call('GET', '/admin/users?filter=banned', boss.token)).json.users.map((u: { username: string }) => u.username)).toEqual(['alice'])
    await call('POST', `/admin/users/${a.id}/unban`, boss.token)
    expect((await call('GET', '/friends', a.token)).status).toBe(200)
  })

  it('times someone out: no messages, comments or voice until it ends', async () => {
    const boss = await admin()
    const a = await register('alice')
    const b = await register('bob')
    await befriend(a, b, 'bob')
    const g = (await call('POST', '/groups', a.token, { name: 'Two', memberIds: [b.id] })).json.group
    expect((await call('POST', `/admin/users/${a.id}/timeout`, boss.token, { minutes: 60 })).status).toBe(204)
    const tries = [
      await call('POST', `/friends/${b.id}/messages`, a.token, { text: 'hi' }),
      await call('POST', `/groups/${g.id}/messages`, a.token, { text: 'hi' }),
      await call('POST', '/games/g:hades/comments', a.token, { text: 'hi' }),
      await call('POST', '/voice/rooms', a.token, {}),
      await call('POST', '/voice/call', a.token, { friendId: b.id })
    ]
    expect(tries.map((t) => [t.status, t.json.code])).toEqual(Array(5).fill([403, 'timed_out']))
    // Reading still works.
    expect((await call('GET', '/friends', a.token)).status).toBe(200)
    expect((await call('GET', '/pulse', a.token)).json.standing.timeoutUntil).toBeGreaterThan(Date.now())
    clock += 61 * 60_000
    expect((await call('POST', `/friends/${b.id}/messages`, a.token, { text: 'back' })).status).toBe(201)
    // Ended early by an admin.
    await call('POST', `/admin/users/${a.id}/timeout`, boss.token, { minutes: 30 })
    await call('POST', `/admin/users/${a.id}/timeout`, boss.token, { minutes: 0 })
    expect((await call('POST', `/friends/${b.id}/messages`, a.token, { text: 'again' })).status).toBe(201)
    expect((await call('POST', `/admin/users/${a.id}/timeout`, boss.token, { minutes: 999_999 })).status).toBe(400)
  })

  it("stops admins acting against each other; only the owner can, and nothing gives the owner away", async () => {
    OWNER_USERNAMES.push('TopDog')
    ADMIN_USERNAMES.push('TopDog', 'AdminTwo')
    let top: { token: string; id: string }, two: { token: string; id: string }
    try {
      top = await register('TopDog')
      two = await register('AdminTwo')
    } finally {
      OWNER_USERNAMES.pop()
      ADMIN_USERNAMES.splice(-2)
    }
    const boss = await admin()
    const a = await register('alice')
    await call('POST', '/games/g:hades/comments', two.token, { text: 'from admin two' })
    const comment = (await call('GET', '/games/g:hades/comments', a.token)).json.comments[0].id

    // One admin against another: every harmful action is refused, with the same words.
    const harmful: [string, string, unknown?][] = [['POST', 'ban', { reason: 'x' }], ['POST', 'timeout', { minutes: 10 }], ['POST', 'roles', { admin: false }], ['POST', 'coins', { amount: -5 }], ['POST', 'reset-profile'], ['POST', 'username', { username: 'renamed_1' }], ['POST', 'delete-comments'], ['POST', 'kick-voice'], ['DELETE', '']]
    for (const victim of [two!, top!]) {
      for (const [m, path, b] of harmful) {
        const r = await call(m, `/admin/users/${victim.id}${path ? `/${path}` : ''}`, boss.token, m === 'DELETE' ? undefined : (b ?? {}))
        expect([victim.id, path, r.status, r.json?.error]).toEqual([victim.id, path, 403, "You can't do that to another admin."])
      }
    }
    expect((await call('DELETE', `/comments/${comment}`, boss.token)).status).toBe(403)
    await call('POST', `/comments/${comment}/report`, a.token, {})
    expect((await call('POST', `/admin/reports/${comment}`, boss.token, { remove: true })).status).toBe(403)
    // Kind things are still fine between admins: coins, a badge, looking.
    expect((await call('POST', `/admin/users/${two!.id}/coins`, boss.token, { amount: 50 })).status).toBe(200)
    expect((await call('POST', `/admin/users/${two!.id}/roles`, boss.token, { verified: true })).status).toBe(200)
    expect((await call('POST', `/admin/users/${two!.id}/roles`, boss.token, { verified: false })).status).toBe(403)
    expect((await call('GET', `/admin/users/${two!.id}/view`, boss.token)).status).toBe(200)
    // And ordinary accounts are moderated as before.
    expect((await call('POST', `/admin/users/${a.id}/timeout`, boss.token, { minutes: 10 })).status).toBe(204)

    // The owner can do all of it to an admin.
    expect((await call('POST', `/admin/users/${two!.id}/timeout`, top!.token, { minutes: 10 })).status).toBe(204)
    expect((await call('DELETE', `/comments/${comment}`, top!.token)).status).toBe(204)
    expect((await call('POST', `/admin/users/${two!.id}/roles`, top!.token, { admin: false })).json).toEqual({ verified: true, admin: false })
    expect((await call('POST', `/admin/users/${boss.id}/ban`, top!.token, { reason: 'Abuse of admin tools' })).status).toBe(204)
    expect((await call('GET', '/admin/overview', boss.token)).status).toBe(403)

    // Nothing the server sends says who the owner is: they look like any other admin.
    const seen = JSON.stringify([
      (await call('GET', '/me', top!.token)).json,
      (await call('GET', '/pulse', top!.token)).json,
      (await call('GET', `/admin/users/${top!.id}`, top!.token)).json.user,
      (await call('GET', '/admin/users', top!.token)).json.users,
      (await call('GET', '/admin/overview', top!.token)).json
    ])
    expect(seen).not.toMatch(/owner|super/i)
    expect((await call('GET', '/me', top!.token)).json.user).toMatchObject({ admin: true, verified: false })
    // It stays with the account through a rename, and the old name gives it to nobody.
    await call('PUT', '/me/username', top!.token, { username: 'top_dog_2' })
    expect((await call('PUT', '/me/username', 't:copycat', { username: 'TopDog' })).status).toBe(200)
    await call('POST', `/admin/users/copycat/roles`, top!.token, { admin: true })
    expect((await call('POST', `/admin/users/${top!.id}/ban`, 't:copycat', {})).status).toBe(403)
    expect((await call('POST', '/admin/users/copycat/ban', top!.token, {})).status).toBe(204)
  })

  it('makes test users to try things on, and shows what an account sees', async () => {
    const boss = await admin()
    const a = await register('alice')
    expect((await call('POST', '/admin/test-users', a.token)).status).toBe(403)
    const t = (await call('POST', '/admin/test-users', boss.token)).json
    expect(t.id).toMatch(/^test-/)
    expect(t.username).toMatch(/^test_\d{5}$/)
    // Listed for admins (marked as a test), never found by players, and nobody can sign in as it.
    expect((await call('GET', `/admin/users?q=${t.username}`, boss.token)).json.users[0]).toMatchObject({ username: t.username, test: true, email: null })
    expect((await call('GET', `/users/search?q=test_`, a.token)).json.users).toEqual([])
    expect((await call('POST', '/auth/sign-in', undefined, { username: t.username, password: 'anything-at-all' })).status).not.toBe(200)

    const view = async (): Promise<any> => (await call('GET', `/admin/users/${t.id}/view`, boss.token)).json
    expect(await view()).toMatchObject({ user: { username: t.username }, coins: 0, banned: null, speaking: null, test: true })
    await call('POST', `/admin/users/${t.id}/coins`, boss.token, { amount: 750 })
    await call('POST', `/admin/users/${t.id}/timeout`, boss.token, { minutes: 30 })
    let v = await view()
    expect(v).toMatchObject({ coins: 750, banned: null })
    expect(v.speaking).toMatch(/^You're timed out and can't do that until /)
    expect(v.ledger[0]).toMatchObject({ kind: 'admin', amount: 750 })
    await call('POST', `/admin/users/${t.id}/ban`, boss.token, { reason: 'Testing the ban screen' })
    v = await view()
    expect(v.banned).toBe('This account has been banned: Testing the ban screen')
    expect(v.standing).toMatchObject({ banned: true, reason: 'Testing the ban screen' })
    // It works for real accounts too, and shows exactly what they are told.
    await call('POST', `/admin/users/${a.id}/ban`, boss.token, { reason: 'Spam' })
    expect((await call('GET', `/admin/users/${a.id}/view`, boss.token)).json.banned).toBe((await call('GET', '/friends', a.token)).json.error)

    await call('POST', '/admin/test-users', boss.token)
    expect((await call('POST', '/admin/test-users/clear', boss.token)).json).toEqual({ removed: 2 })
    expect((await call('GET', '/admin/users', boss.token)).json.users.map((u: { username: string }) => u.username).sort()).toEqual(['TestBoss', 'alice'])
  })

  it('resets a profile, renames, clears the username wait, removes comments and deletes an account', async () => {
    const boss = await admin()
    const a = await register('alice')
    await call('PUT', '/me/profile', a.token, { bio: 'something rude', style: { frame: 'gold' } })
    await call('POST', '/games/g:hades/comments', a.token, { text: 'one' })
    await call('POST', `/admin/users/${a.id}/reset-profile`, boss.token)
    expect((await call('GET', '/me', a.token)).json.user).toMatchObject({ bio: '', avatar: null, style: { frame: 'none' } })

    expect((await call('POST', `/admin/users/${a.id}/username`, boss.token, { username: 'TestBoss' })).status).toBe(409)
    expect((await call('POST', `/admin/users/${a.id}/username`, boss.token, { username: 'player_1234' })).status).toBe(204)
    // An admin's rename doesn't start the player's own 30 days.
    expect((await call('PUT', '/me/username', a.token, { username: 'alice_new' })).status).toBe(200)
    expect((await call('PUT', '/me/username', a.token, { username: 'alice_newer' })).status).toBe(429)
    await call('POST', `/admin/users/${a.id}/clear-cooldown`, boss.token)
    expect((await call('PUT', '/me/username', a.token, { username: 'alice_newer' })).status).toBe(200)

    expect((await call('POST', `/admin/users/${a.id}/delete-comments`, boss.token)).json).toEqual({ removed: 1 })
    expect((await call('POST', `/admin/users/${a.id}/roles`, boss.token, { verified: true })).json).toEqual({ verified: true, admin: false })
    expect((await call('POST', `/admin/users/${boss.id}/roles`, boss.token, { admin: false })).status).toBe(400) // not your own crown
    expect((await call('DELETE', `/admin/users/${boss.id}`, boss.token)).status).toBe(400)
    expect((await call('DELETE', `/admin/users/${a.id}`, boss.token)).status).toBe(204)
    expect((await call('GET', '/me', a.token)).json.user.username).toBeNull()
    expect((await call('GET', `/admin/users/${a.id}`, boss.token)).status).toBe(404)
  })
})
