import { createHmac, timingSafeEqual } from 'node:crypto'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { body, fail, toMs, type Env } from './app'
import { COIN_BUNDLES, COIN_CURRENCY, SHOP_ITEMS, VANITY_PLUS } from './coinBundles'
import { DEFAULT_STYLE, readStyle } from './profileStyle'
import type { Sql } from './db'

// Vanity Coins: buying them with real money (Stripe Checkout), spending them, and the record.
//
// The rules that keep money safe:
//  - The app only names a bundle. What it costs and how many coins it is come from coinBundles.ts.
//  - Coins are added only when Stripe tells this server, in a message signed with the webhook
//    secret, that the payment went through. Never because the app (or the browser) says so.
//  - Every change is a row in the ledger, and (kind, ref) is unique: the same Stripe message, or
//    the same purchase, can't be counted twice however often it arrives.
//  - Stripe's keys live only in this server's environment. They are never in the app.

export interface StripeConfig {
  /** A secret key (sk_test_… / sk_live_…) or a restricted key (rk_…) that may create Checkout Sessions. */
  secretKey: string
  /** The signing secret of the webhook endpoint (whsec_…). */
  webhookSecret: string
}

export type LedgerKind = 'purchase' | 'spend' | 'refund' | 'chargeback' | 'reversal' | 'admin'

interface CoinDeps {
  sql: Sql
  requireAuth: MiddlewareHandler<Env>
  requireUser: MiddlewareHandler<Env>
  stripe?: StripeConfig
  fetchFn: typeof fetch
  now: () => number
  /** This server's own public address, for the pages Stripe sends the browser back to. */
  origin(c: Context<Env>): string
}

/** Stripe signs "<time>.<body>" with the webhook secret. Old or wrongly signed messages are refused. */
export function validStripeSignature(payload: string, header: string | undefined, secret: string, nowMs: number, toleranceMs = 5 * 60_000): boolean {
  if (!header || !secret) return false
  const parts = header.split(',').map((p) => p.trim().split('='))
  const t = parts.find(([k]) => k === 't')?.[1]
  const sent = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
  if (!t || !/^\d+$/.test(t) || !sent.length) return false
  if (Math.abs(nowMs - Number(t) * 1000) > toleranceMs) return false
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex'))
  return sent.some((v) => {
    const got = Buffer.from(v ?? '')
    return got.length === expected.length && timingSafeEqual(got, expected)
  })
}

const page = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Vanity</title><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d12;color:#e8eaf0;font-family:system-ui,sans-serif"><div style="max-width:26rem;padding:2rem;text-align:center"><p style="font-size:2rem;font-weight:800;margin:0">Van<span style="color:#ff4655">ity</span></p><h1 style="font-size:1.25rem">${title}</h1><p style="color:#9aa3b2;line-height:1.5">${text}</p></div>`

export function coinRoutes({ sql, requireAuth, requireUser, stripe, fetchFn, now, origin }: CoinDeps) {
  const routes = new Hono<Env>()
  const webhook = new Hono<Env>()
  const enabled = !!stripe?.secretKey && !!stripe.webhookSecret

  /**
   * Adds a row to the ledger and moves the balance by the same amount, as one statement.
   * Returns the new balance, or null when that (kind, ref) was already written: nothing changes.
   */
  async function grant(userId: string, amount: number, kind: LedgerKind, ref: string, note = ''): Promise<number | null> {
    const rows = await sql<{ balance: number }>`
      WITH e AS (
        INSERT INTO vanity.coin_ledger (user_id, kind, amount, ref, note, created_at)
        VALUES (${userId}, ${kind}, ${Math.trunc(amount)}::int, ${ref}, ${note.slice(0, 300)}, to_timestamp(${now() / 1000}))
        ON CONFLICT (kind, ref) DO NOTHING RETURNING user_id, amount
      )
      INSERT INTO vanity.coin_wallets (user_id, balance) SELECT user_id, amount FROM e
      ON CONFLICT (user_id) DO UPDATE SET balance = vanity.coin_wallets.balance + excluded.balance
      RETURNING balance`
    return rows[0]?.balance ?? null
  }

  const balanceOf = async (userId: string): Promise<number> => (await sql<{ balance: number }>`SELECT balance FROM vanity.coin_wallets WHERE user_id = ${userId}`)[0]?.balance ?? 0
  const ownedBy = async (userId: string): Promise<string[]> => (await sql<{ item_id: string }>`SELECT item_id FROM vanity.shop_owned WHERE user_id = ${userId}`).map((r) => r.item_id)

  // ---- Vanity Plus ---------------------------------------------------------------

  type PlusRow = { stripe_customer: string | null; subscription_id: string | null; status: string; period_end: unknown; cancel_at_period_end: boolean; comp_until: unknown }
  /** Stripe's states in which the member keeps Plus (while a failed payment is being retried, too). */
  const LIVE = ['active', 'trialing', 'past_due']
  async function plusOf(userId: string) {
    const [r] = await sql<PlusRow>`SELECT stripe_customer, subscription_id, status, period_end, cancel_at_period_end, comp_until FROM vanity.plus_members WHERE user_id = ${userId}`
    const comp = toMs(r?.comp_until)
    const gifted = !!comp && comp > now()
    const subscribed = !!r && LIVE.includes(r.status)
    return {
      active: subscribed || gifted,
      /** Paying through Stripe right now (as opposed to given by an admin). */
      subscribed,
      status: r?.status ?? 'none',
      renewsAt: subscribed ? toMs(r!.period_end) : null,
      endsAtPeriodEnd: subscribed && r!.cancel_at_period_end,
      giftedUntil: gifted ? comp : null,
      /** Has a Stripe customer, so the "manage" page can be opened. */
      canManage: !!r?.stripe_customer,
      customer: r?.stripe_customer ?? null
    }
  }
  const isPlus = async (userId: string): Promise<boolean> => (await plusOf(userId)).active

  /** Plus is over: looks that came with it (and were never bought) come off the profile. */
  async function dropUnownedLooks(userId: string): Promise<void> {
    const [p] = await sql<{ style: unknown }>`SELECT style FROM vanity.profiles WHERE id = ${userId}`
    if (!p) return
    const style = readStyle(p.style)
    const owned = new Set(await ownedBy(userId))
    let changed = false
    for (const key of Object.keys(style) as (keyof typeof style)[]) {
      const item = `${key}:${style[key]}`
      if (SHOP_ITEMS[item] && !owned.has(item)) {
        style[key] = DEFAULT_STYLE[key]
        changed = true
      }
    }
    if (changed) await sql`UPDATE vanity.profiles SET style = ${JSON.stringify(style)} WHERE id = ${userId}`
  }

  /** Gives Plus without a payment until a time (an admin's gift); 0 days takes a gift away. */
  async function giftPlus(userId: string, days: number): Promise<void> {
    const until = days > 0 ? (now() + days * 86_400_000) / 1000 : null
    await sql`INSERT INTO vanity.plus_members (user_id, comp_until) VALUES (${userId}, CASE WHEN ${until}::float8 IS NULL THEN NULL ELSE to_timestamp(${until}::float8) END)
      ON CONFLICT (user_id) DO UPDATE SET comp_until = excluded.comp_until, updated_at = now()`
    if (!(await isPlus(userId))) await dropUnownedLooks(userId)
  }

  /** The first premium look in a profile change that this account hasn't bought, if any. */
  async function lockedLook(userId: string, patch: Record<string, unknown>): Promise<{ id: string; price: number; name: string } | null> {
    const wanted = Object.entries(patch).map(([k, v]) => `${k}:${String(v)}`).filter((id) => SHOP_ITEMS[id])
    if (!wanted.length) return null
    // Vanity Plus includes every premium look.
    if (await isPlus(userId)) return null
    const owned = new Set(await ownedBy(userId))
    const id = wanted.find((w) => !owned.has(w))
    return id ? { id, ...SHOP_ITEMS[id] } : null
  }

  // ---- the store ----------------------------------------------------------------

  routes.get('/done', (c) =>
    c.html(
      c.req.query('plus')
        ? page('Welcome to Vanity Plus', 'You can close this tab and go back to Vanity. Your membership shows there within a few seconds.')
        : c.req.query('managed')
          ? page('All set', 'You can close this tab and go back to Vanity.')
          : page('Thanks! Your coins are on their way', 'You can close this tab and go back to Vanity. Your balance updates by itself within a few seconds.')
    )
  )
  routes.get('/cancelled', (c) => c.html(page('Nothing was bought', 'The purchase was cancelled and you were not charged. You can close this tab and go back to Vanity.')))

  routes.use('*', requireAuth, requireUser)

  routes.get('/', async (c) => {
    const me = c.get('userId')
    c.header('Cache-Control', 'no-store')
    const plus = await plusOf(me)
    // A membership or gift that ran out since the last look: what came with it comes off.
    if (!plus.active) await dropUnownedLooks(me)
    return c.json({
      plus: { active: plus.active, subscribed: plus.subscribed, status: plus.status, renewsAt: plus.renewsAt, endsAtPeriodEnd: plus.endsAtPeriodEnd, giftedUntil: plus.giftedUntil, canManage: plus.canManage, name: VANITY_PLUS.name, priceCents: VANITY_PLUS.priceCents, interval: VANITY_PLUS.interval },
      balance: await balanceOf(me),
      purchasesEnabled: enabled,
      currency: COIN_CURRENCY,
      bundles: COIN_BUNDLES,
      items: Object.entries(SHOP_ITEMS).map(([id, i]) => ({ id, ...i })),
      owned: await ownedBy(me)
    })
  })

  /** Starts a Stripe Checkout for a bundle and answers with the page to open in the browser. */
  routes.post('/checkout', async (c) => {
    const me = c.get('userId')
    const { bundleId } = await body<{ bundleId: string }>(c)
    const bundle = COIN_BUNDLES.find((b) => b.id === bundleId)
    if (!bundle) fail(400, "That coin bundle doesn't exist any more. Open the store again.")
    if (!enabled) fail(409, "Buying coins isn't set up yet.", 'purchases_off')
    const recent = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM vanity.coin_orders WHERE user_id = ${me} AND created_at > to_timestamp(${(now() - 10 * 60_000) / 1000})`
    if ((recent[0]?.n ?? 0) >= 10) fail(429, 'Too many purchases started. Wait a few minutes and try again.')
    const base = origin(c)
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: `${base}/coins/done`,
      cancel_url: `${base}/coins/cancelled`,
      client_reference_id: me,
      'metadata[user_id]': me,
      'metadata[bundle_id]': bundle!.id,
      'payment_intent_data[metadata][user_id]': me,
      'payment_intent_data[metadata][bundle_id]': bundle!.id,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': COIN_CURRENCY,
      'line_items[0][price_data][unit_amount]': String(bundle!.priceCents),
      'line_items[0][price_data][product_data][name]': `${bundle!.coins.toLocaleString('en-US')} Vanity Coins`
    })
    let res: Response
    try {
      res = await fetchFn('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: `Bearer ${stripe!.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal: AbortSignal.timeout(20_000) })
    } catch {
      return c.json({ error: "The payment service can't be reached. Try again in a moment." }, 503)
    }
    const session = (await res.json().catch(() => null)) as { id?: string; url?: string; error?: { message?: string } } | null
    if (!res.ok || !session?.id || !session.url || !/^https:\/\/checkout\.stripe\.com\//.test(session.url)) {
      console.error('[coins] Stripe refused a checkout:', res.status, session?.error?.message)
      return c.json({ error: "The payment page couldn't be opened. Try again in a moment." }, 502)
    }
    // Remembered here, so what is credited later is what THIS server offered, whatever a message claims.
    await sql`INSERT INTO vanity.coin_orders (session_id, user_id, bundle_id, coins, amount_cents, currency, created_at)
      VALUES (${session.id}, ${me}, ${bundle!.id}, ${bundle!.coins}, ${bundle!.priceCents}, ${COIN_CURRENCY}, to_timestamp(${now() / 1000}))`
    return c.json({ url: session.url })
  })

  /** Talks to Stripe's API (form-encoded, as it wants). */
  async function stripePost(path: string, form: Record<string, string>): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
    const res = await fetchFn(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { authorization: `Bearer ${stripe!.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(20_000) })
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) console.error('[coins] Stripe refused', path, res.status, (json?.error as { message?: string } | undefined)?.message)
    return { ok: res.ok, status: res.status, json }
  }

  /** Starts a Vanity Plus subscription on Stripe's payment page. */
  routes.post('/plus/checkout', async (c) => {
    const me = c.get('userId')
    if (!enabled) fail(409, "Vanity Plus isn't set up yet.", 'purchases_off')
    const plus = await plusOf(me)
    if (plus.subscribed) fail(409, "You already have Vanity Plus. Use Manage to change or cancel it.", 'already_plus')
    const base = origin(c)
    let r: Awaited<ReturnType<typeof stripePost>>
    try {
      r = await stripePost('checkout/sessions', {
        mode: 'subscription',
        success_url: `${base}/coins/done?plus=1`,
        cancel_url: `${base}/coins/cancelled`,
        client_reference_id: me,
        'metadata[user_id]': me,
        'metadata[kind]': 'plus',
        // The subscription itself carries who it is for: every later message about it says so.
        'subscription_data[metadata][user_id]': me,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': COIN_CURRENCY,
        'line_items[0][price_data][unit_amount]': String(VANITY_PLUS.priceCents),
        'line_items[0][price_data][recurring][interval]': VANITY_PLUS.interval,
        'line_items[0][price_data][product_data][name]': VANITY_PLUS.name,
        // Someone who subscribed before keeps the same Stripe customer (their card and invoices).
        ...(plus.customer ? { customer: plus.customer } : {})
      })
    } catch {
      return c.json({ error: "The payment service can't be reached. Try again in a moment." }, 503)
    }
    const url = r.json?.url
    if (!r.ok || typeof url !== 'string' || !/^https:\/\/checkout\.stripe\.com\//.test(url)) return c.json({ error: "The payment page couldn't be opened. Try again in a moment." }, 502)
    return c.json({ url })
  })

  /** Stripe's own page for a member to change their card, see invoices, or cancel. */
  routes.post('/plus/portal', async (c) => {
    const me = c.get('userId')
    if (!enabled) fail(409, "Vanity Plus isn't set up yet.", 'purchases_off')
    const plus = await plusOf(me)
    if (!plus.customer) fail(404, "You don't have a Vanity Plus membership to manage.")
    let r: Awaited<ReturnType<typeof stripePost>>
    try {
      r = await stripePost('billing_portal/sessions', { customer: plus.customer!, return_url: `${origin(c)}/coins/done?managed=1` })
    } catch {
      return c.json({ error: "The payment service can't be reached. Try again in a moment." }, 503)
    }
    const url = r.json?.url
    if (!r.ok || typeof url !== 'string' || !/^https:\/\/billing\.stripe\.com\//.test(url)) return c.json({ error: "The membership page couldn't be opened. Try again in a moment." }, 502)
    return c.json({ url })
  })

  /** Spends coins on something from the shop. */
  routes.post('/buy', async (c) => {
    const me = c.get('userId')
    const { itemId } = await body<{ itemId: string }>(c)
    const item = typeof itemId === 'string' ? SHOP_ITEMS[itemId] : undefined
    if (!item) fail(400, "That isn't for sale.")
    if ((await ownedBy(me)).includes(itemId!)) fail(409, 'You already own that.')
    if (await isPlus(me)) fail(409, 'This is included with your Vanity Plus. You can wear it now.', 'included_in_plus')
    // One statement: the balance only goes down if it is enough, and the ledger row and the item come with it.
    const rows = await sql<{ balance: number }>`
      WITH paid AS (
        UPDATE vanity.coin_wallets SET balance = balance - ${item!.price}::int
        WHERE user_id = ${me} AND balance >= ${item!.price}::int RETURNING user_id, balance
      ), entry AS (
        INSERT INTO vanity.coin_ledger (user_id, kind, amount, ref, note, created_at)
        SELECT user_id, 'spend', ${-item!.price}::int, ${`${me}:${itemId}`}::text, ${item!.name}::text, to_timestamp(${now() / 1000}) FROM paid RETURNING id
      ), own AS (
        INSERT INTO vanity.shop_owned (user_id, item_id) SELECT user_id, ${itemId}::text FROM paid RETURNING item_id
      )
      SELECT balance FROM paid`
    if (!rows.length) fail(402, `You need ${item!.price.toLocaleString('en-US')} coins for that.`, 'not_enough_coins')
    return c.json({ balance: rows[0].balance, owned: await ownedBy(me) })
  })

  /** Everything that ever changed this account's coins, newest first. */
  routes.get('/history', async (c) => {
    const me = c.get('userId')
    const before = /^\d{1,15}$/.test(c.req.query('before') ?? '') ? Number(c.req.query('before')) : null
    const rows = await sql<{ id: string | number; kind: LedgerKind; amount: number; ref: string; note: string; created_at: unknown; amount_cents: number | null; currency: string | null; status: string | null }>`
      SELECT l.id, l.kind, l.amount, l.ref, l.note, l.created_at, o.amount_cents, o.currency, o.status
      FROM vanity.coin_ledger l LEFT JOIN vanity.coin_orders o ON l.kind = 'purchase' AND o.session_id = l.ref
      WHERE l.user_id = ${me} AND (${before}::bigint IS NULL OR l.id < ${before}::bigint) ORDER BY l.id DESC LIMIT 31`
    return c.json({
      balance: await balanceOf(me),
      entries: rows.slice(0, 30).map((r) => ({ id: Number(r.id), kind: r.kind, amount: r.amount, note: r.note, at: toMs(r.created_at), paidCents: r.amount_cents, currency: r.currency, status: r.status })),
      hasMore: rows.length > 30
    })
  })

  // ---- messages from Stripe -------------------------------------------------------

  type Order = { session_id: string; user_id: string; coins: number; amount_cents: number; currency: string; status: string; refunded_coins: number }
  const orderByIntent = async (intent: unknown): Promise<Order | null> =>
    typeof intent === 'string' && intent ? ((await sql<Order>`SELECT session_id, user_id, coins, amount_cents, currency, status, refunded_coins FROM vanity.coin_orders WHERE payment_intent = ${intent}`)[0] ?? null) : null

  /**
   * What Stripe says about a subscription, written down. `at` is when Stripe made the message:
   * an older one arriving after a newer one changes nothing.
   */
  async function subscriptionChanged(sub: Record<string, unknown>, at: number, gone = false): Promise<void> {
    const id = String(sub.id ?? '')
    const customer = typeof sub.customer === 'string' ? sub.customer : null
    let userId = (sub.metadata as { user_id?: unknown } | undefined)?.user_id
    if (typeof userId !== 'string' || !userId) {
      const [known] = await sql<{ user_id: string }>`SELECT user_id FROM vanity.plus_members WHERE subscription_id = ${id} OR (${customer}::text IS NOT NULL AND stripe_customer = ${customer}) LIMIT 1`
      userId = known?.user_id
    }
    if (typeof userId !== 'string' || !userId || !id) return console.error('[plus] a subscription message with nobody to give it to:', id)
    // Where the paid-for time ends (newer Stripe versions keep it on the item).
    const items = (sub.items as { data?: { current_period_end?: unknown }[] } | undefined)?.data
    const end = Number(sub.current_period_end ?? items?.[0]?.current_period_end) || null
    const status = gone ? 'canceled' : String(sub.status ?? 'none')
    await sql`INSERT INTO vanity.plus_members (user_id, stripe_customer, subscription_id, status, period_end, cancel_at_period_end, event_at, updated_at)
      VALUES (${userId}, ${customer}, ${id}, ${status}, CASE WHEN ${end}::float8 IS NULL THEN NULL ELSE to_timestamp(${end}::float8) END, ${sub.cancel_at_period_end === true}, ${at}, now())
      ON CONFLICT (user_id) DO UPDATE SET stripe_customer = COALESCE(excluded.stripe_customer, vanity.plus_members.stripe_customer), subscription_id = excluded.subscription_id,
        status = excluded.status, period_end = excluded.period_end, cancel_at_period_end = excluded.cancel_at_period_end, event_at = excluded.event_at, updated_at = now()
      WHERE vanity.plus_members.event_at <= excluded.event_at
        -- A message about an old, finished subscription doesn't touch a newer one that is running.
        AND (vanity.plus_members.subscription_id IS NULL OR vanity.plus_members.subscription_id = excluded.subscription_id OR vanity.plus_members.status NOT IN ('active', 'trialing', 'past_due'))`
    if (!(await isPlus(userId))) await dropUnownedLooks(userId)
  }

  /** The Plus checkout went through: Plus starts now (the subscription's own messages fill in the dates). */
  async function plusStarted(session: Record<string, unknown>, at: number): Promise<void> {
    const userId = (session.metadata as { user_id?: unknown } | undefined)?.user_id
    if (typeof userId !== 'string' || !userId || session.payment_status === 'unpaid') return
    const customer = typeof session.customer === 'string' ? session.customer : null
    const sub = typeof session.subscription === 'string' ? session.subscription : null
    await sql`INSERT INTO vanity.plus_members (user_id, stripe_customer, subscription_id, status, event_at, updated_at) VALUES (${userId}, ${customer}, ${sub}, 'active', ${at}, now())
      ON CONFLICT (user_id) DO UPDATE SET stripe_customer = COALESCE(excluded.stripe_customer, vanity.plus_members.stripe_customer),
        subscription_id = COALESCE(excluded.subscription_id, vanity.plus_members.subscription_id),
        status = CASE WHEN vanity.plus_members.event_at <= excluded.event_at THEN 'active' ELSE vanity.plus_members.status END,
        event_at = GREATEST(vanity.plus_members.event_at, excluded.event_at), updated_at = now()`
  }

  /** A Checkout was paid: add the coins this server offered for it. */
  async function paid(session: Record<string, unknown>): Promise<void> {
    if (session.payment_status !== 'paid') return
    const [order] = await sql<Order>`SELECT session_id, user_id, coins, amount_cents, currency, status, refunded_coins FROM vanity.coin_orders WHERE session_id = ${String(session.id)}`
    if (!order) return console.error('[coins] paid checkout with no order here:', session.id)
    // The amount Stripe took must be what was asked.
    if (session.amount_total !== order.amount_cents || String(session.currency).toLowerCase() !== order.currency) return console.error('[coins] paid amount differs from the order:', session.id)
    await sql`UPDATE vanity.coin_orders SET status = 'paid', payment_intent = ${typeof session.payment_intent === 'string' ? session.payment_intent : null}, paid_at = COALESCE(paid_at, to_timestamp(${now() / 1000})) WHERE session_id = ${order.session_id} AND status IN ('pending', 'paid')`
    await grant(order.user_id, order.coins, 'purchase', order.session_id, `${order.coins.toLocaleString('en-US')} Vanity Coins`)
  }

  /** Money went back (all or part): the same share of the coins comes off, even if that leaves a debt. */
  async function refunded(charge: Record<string, unknown>): Promise<void> {
    const order = await orderByIntent(charge.payment_intent)
    const total = Number(charge.amount)
    const back = Number(charge.amount_refunded)
    if (!order || !(total > 0) || !(back > 0)) return
    const target = Math.min(order.coins, Math.round((order.coins * back) / total))
    const take = target - order.refunded_coins
    if (take > 0) await grant(order.user_id, -take, 'refund', `${String(charge.id)}:${back}`, 'Refund')
    await sql`UPDATE vanity.coin_orders SET refunded_coins = GREATEST(refunded_coins, ${target}::int), status = ${back >= total ? 'refunded' : 'partly refunded'} WHERE session_id = ${order.session_id}`
  }

  /** The bank took the money back (a chargeback): the coins that are left from that purchase come off. */
  async function disputed(dispute: Record<string, unknown>): Promise<void> {
    const order = await orderByIntent(dispute.payment_intent)
    if (!order) return
    const take = order.coins - order.refunded_coins
    if (take > 0) await grant(order.user_id, -take, 'chargeback', String(dispute.id), 'Payment disputed')
    await sql`UPDATE vanity.coin_orders SET status = 'disputed' WHERE session_id = ${order.session_id}`
  }

  /** The dispute was decided in Vanity's favour: the coins go back. */
  async function disputeClosed(dispute: Record<string, unknown>): Promise<void> {
    if (dispute.status !== 'won') return
    const [taken] = await sql<{ user_id: string; amount: number }>`SELECT user_id, amount FROM vanity.coin_ledger WHERE kind = 'chargeback' AND ref = ${String(dispute.id)}`
    if (!taken) return
    await grant(taken.user_id, -taken.amount, 'reversal', String(dispute.id), 'Dispute won')
    const order = await orderByIntent(dispute.payment_intent)
    if (order) await sql`UPDATE vanity.coin_orders SET status = 'paid' WHERE session_id = ${order.session_id}`
  }

  webhook.post('/webhook', async (c) => {
    const payload = await c.req.text()
    if (!enabled) return c.json({ error: 'Stripe is not set up on this server.' }, 503)
    if (!validStripeSignature(payload, c.req.header('stripe-signature'), stripe!.webhookSecret, now())) return c.json({ error: 'Bad signature.' }, 400)
    let event: { id?: string; type?: string; created?: number; data?: { object?: Record<string, unknown> } }
    try {
      event = JSON.parse(payload) as typeof event
    } catch {
      return c.json({ error: 'Not JSON.' }, 400)
    }
    const object = event.data?.object
    if (typeof event.id !== 'string' || typeof event.type !== 'string' || !object) return c.json({ error: 'Not an event.' }, 400)
    // Seen before: nothing to do. (Each step below is also safe to repeat by itself, so an event
    // that failed half-way is finished when Stripe sends it again.)
    const seen = await sql`SELECT 1 FROM vanity.stripe_events WHERE id = ${event.id}`
    if (seen.length) return c.json({ received: true, duplicate: true })
    const at = Number(event.created) || Math.floor(now() / 1000)
    const isPlusCheckout = object.mode === 'subscription'
    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') await subscriptionChanged(object, at)
    else if (event.type === 'customer.subscription.deleted') await subscriptionChanged(object, at, true)
    else if ((event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') && isPlusCheckout) await plusStarted(object, at)
    else if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') await paid(object)
    else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') await sql`UPDATE vanity.coin_orders SET status = 'not paid' WHERE session_id = ${String(object.id)} AND status = 'pending'`
    else if (event.type === 'charge.refunded') await refunded(object)
    else if (event.type === 'charge.dispute.created') await disputed(object)
    else if (event.type === 'charge.dispute.closed') await disputeClosed(object)
    await sql`INSERT INTO vanity.stripe_events (id, type) VALUES (${event.id}, ${event.type}) ON CONFLICT DO NOTHING`
    return c.json({ received: true })
  })

  return { routes, webhook, grant, balanceOf, ownedBy, lockedLook, enabled, giftPlus, plusOf }
}
