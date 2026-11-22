import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Check, Coins, ExternalLink, History, Loader2, Lock, ShieldCheck, Sparkles } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { Button, Dialog } from '@/components/Dialog'
import { ProfileTitle, UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { isAndroid } from '@/lib/platform'
import { useAccount } from '@/state/account'
import { checkPulse, usePulse } from '@/state/pulse'
import { buyItem, formatPrice, refreshShop, useShop, type CoinBundle, type ShopItem } from '@/state/shop'
import { useToast } from '@/state/toasts'

const n = (v: number): string => v.toLocaleString()

const KIND_LABEL: Record<string, string> = { banner: 'Banner', effect: 'Banner effect', frame: 'Picture frame', aura: 'Picture aura', nameStyle: 'Name effect', nameFont: 'Name font', title: 'Title', flair: 'Emoji' }

/**
 * The thing itself, as it will look on your profile: the real banner, frame, aura, name effect or
 * title, drawn with the same styles the profile uses, on your own picture and name.
 */
export function LookPreview({ itemId, name, avatar, large }: { itemId: string; name: string; avatar: string | null; large?: boolean }): React.JSX.Element {
  const [part, ...rest] = itemId.split(':')
  const id = rest.join(':')
  const box = cn('relative flex items-center justify-center overflow-clip bg-surface-2', large ? 'h-40' : 'h-28')
  const who = <Avatar name={name} src={avatar} size="lg" />
  if (part === 'banner' || part === 'effect')
    return (
      <div className={box} data-look-preview={itemId}>
        <div className="profile-banner" data-banner={part === 'banner' ? id : 'default'} data-fx={part === 'effect' ? id : 'none'} />
        <div className="relative flex items-center gap-3">
          {who}
          <span className="font-display text-lg font-bold drop-shadow">{name}</span>
        </div>
      </div>
    )
  if (part === 'frame' || part === 'aura')
    return (
      <div className={box} data-look-preview={itemId}>
        <div className="profile-banner opacity-40" data-banner="default" />
        <Avatar name={name} src={avatar} size="xl" frame={part === 'frame' ? id : undefined} aura={part === 'aura' ? id : undefined} />
      </div>
    )
  if (part === 'nameStyle' || part === 'nameFont')
    return (
      <div className={box} data-look-preview={itemId}>
        <span className={cn('font-display font-black', large ? 'text-4xl' : 'text-2xl')}>
          <UserName name={name} style={part === 'nameStyle' ? { nameStyle: id } : { nameFont: id }} />
        </span>
      </div>
    )
  if (part === 'title')
    return (
      <div className={cn(box, 'flex-col gap-1.5')} data-look-preview={itemId}>
        <span className="font-display text-lg font-bold">{name}</span>
        <ProfileTitle title={id} />
      </div>
    )
  return (
    <div className={box} data-look-preview={itemId}>
      <Sparkles className="size-8 text-amber-300" />
    </div>
  )
}

/** The balance, big. */
function Balance({ coins }: { coins: number }): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-amber-300/25 bg-gradient-to-br from-amber-400/15 via-surface to-surface p-5" data-coin-balance={coins}>
      <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-400/20 text-amber-300">
        <Coins className="size-7" />
      </span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Your balance</p>
        <p className="font-display text-4xl font-black tabular-nums">
          {n(coins)} <span className="text-base font-semibold text-muted">Vanity Coins</span>
        </p>
        {coins < 0 && <p className="mt-1 text-xs text-accent">A payment was refunded after its coins were spent. Coins you get next go towards this first.</p>}
      </div>
    </div>
  )
}

/**
 * Get Coins: the bundles (bought on Stripe's own payment page, in the browser) and what coins
 * can be spent on. Prices come from the server. Coins arrive when the payment has gone through,
 * and the balance here updates by itself.
 */
export function CoinsPage(): React.JSX.Element {
  const account = useAccount()
  const shop = useShop(!!account?.username)
  const coins = usePulse().coins
  const toast = useToast()
  const navigate = useNavigate()
  const [opening, setOpening] = useState<string | null>(null)
  /** A payment page was opened: watch for the coins. */
  const [waiting, setWaiting] = useState(false)
  const [buying, setBuying] = useState<ShopItem | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => void refreshShop(), [])
  // While a payment page is open, look for the coins every couple of seconds.
  useEffect(() => {
    if (!waiting) return
    const start = coins
    const timer = setInterval(() => void checkPulse(), 2500)
    const stop = setTimeout(() => setWaiting(false), 15 * 60_000)
    if (start !== null && shop && coins !== null && coins > shop.balance) setWaiting(false)
    return () => {
      clearInterval(timer)
      clearTimeout(stop)
    }
  }, [waiting, coins, shop])
  const before = shop?.balance
  useEffect(() => {
    if (waiting && before !== undefined && coins !== null && coins > before) {
      setWaiting(false)
      toast(`${n(coins - before)} Vanity Coins added`)
    }
  }, [coins]) // eslint-disable-line react-hooks/exhaustive-deps

  const balance = coins ?? shop?.balance ?? 0
  const phone = isAndroid()

  const checkout = async (b: CoinBundle): Promise<void> => {
    setOpening(b.id)
    const r = await window.vanity.account.request<{ url: string }>('POST', '/coins/checkout', { bundleId: b.id }).catch(() => null)
    setOpening(null)
    if (!r || r.error !== undefined) return toast(r?.error ?? "Couldn't open the payment page.", 'error')
    // Only Stripe's own payment page is ever opened.
    if (!/^https:\/\/checkout\.stripe\.com\//.test(r.data.url)) return toast("Couldn't open the payment page.", 'error')
    window.open(r.data.url, '_blank')
    setWaiting(true)
  }

  if (!account?.username) return <div className="h-full" />
  return (
    <div className="h-full overflow-y-auto" data-coins-page>
      <div className="stagger mx-auto w-full max-w-5xl space-y-6 px-10 pb-16 pt-12 max-md:px-4 max-md:pt-14">
        <div className="flex flex-wrap items-end gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Get Coins</h1>
          <Link to="/account/purchases" className="ml-auto inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-text" data-purchases-link>
            <History className="size-4" /> Purchase history
          </Link>
        </div>

        <Balance coins={balance} />

        {waiting && (
          <p className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted" data-coins-waiting>
            <Loader2 className="size-4 shrink-0 animate-spin" /> The payment page is open in your browser. Your coins show up here by themselves once the payment has gone through.
          </p>
        )}

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">Coin bundles</h2>
          {!shop ? (
            <div className="flex h-32 items-center justify-center text-muted">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
              {shop.bundles.map((b) => (
                <div key={b.id} className={cn('relative flex flex-col items-center rounded-2xl border bg-surface p-5 text-center transition hover:-translate-y-0.5', b.tag ? 'border-accent/50 shadow-lg shadow-accent/10' : 'border-border')} data-bundle={b.id}>
                  {b.tag && <span className="absolute -top-2.5 rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">{b.tag}</span>}
                  <Coins className="size-8 text-amber-300" />
                  <p className="mt-2 font-display text-3xl font-black tabular-nums">{n(b.coins)}</p>
                  <p className="text-xs text-muted">Vanity Coins</p>
                  <Button variant="primary" className="mt-4 w-full" disabled={phone || !shop.purchasesEnabled || opening !== null} onClick={() => void checkout(b)} data-buy-bundle={b.id}>
                    {opening === b.id ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />} {formatPrice(b.priceCents, shop.currency)}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 flex items-start gap-2 text-xs text-muted" data-coins-note>
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
            {phone
              ? 'Buying coins is on the Windows app for now. Coins you have work here too.'
              : shop && !shop.purchasesEnabled
                ? "Buying coins isn't switched on yet. Coins you're given still work."
                : 'You pay on Stripe’s secure page in your browser. Vanity never sees your card. Coins are added when the payment has gone through.'}
          </p>
        </section>

        {shop && shop.items.length > 0 && (
          <section data-coin-shop>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">Spend them on</h2>
            <p className="mb-3 text-sm text-muted">Premium looks for your profile. Once bought they're yours for good: wear them from Account → Profile look.</p>
            <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-3 max-lg:grid-cols-2">
              {shop.items.map((i) => {
                const owned = shop.owned.includes(i.id)
                return (
                  <div key={i.id} className={cn('group flex flex-col overflow-hidden rounded-2xl border bg-surface transition hover:-translate-y-0.5 hover:border-white/25', owned ? 'border-emerald-400/30' : 'border-border')} data-shop-item={i.id}>
                    <LookPreview itemId={i.id} name={account.username ?? 'You'} avatar={account.avatar} />
                    <div className="flex flex-1 flex-col gap-2.5 p-3.5">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{KIND_LABEL[i.id.split(':')[0]] ?? 'Item'}</p>
                        <p className="truncate text-sm font-semibold">{i.name}</p>
                      </div>
                      {owned ? (
                        <span className="mt-auto flex h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-400/10 text-xs font-semibold text-emerald-400">
                          <Check className="size-3.5" /> Owned
                        </span>
                      ) : (
                        <Button className="mt-auto h-9 w-full text-xs" onClick={() => setBuying(i)} data-buy-item={i.id}>
                          {balance < i.price && <Lock className="size-3" />} <Coins className="size-3.5 text-amber-300" /> {n(i.price)}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>

      {buying && (
        <Dialog
          title={`Get ${buying.name}?`}
          description={balance >= buying.price ? `It costs ${n(buying.price)} Vanity Coins. You have ${n(balance)}.` : `It costs ${n(buying.price)} Vanity Coins and you have ${n(balance)}. Get a bundle above first.`}
          onClose={() => setBuying(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setBuying(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={busy || balance < buying.price}
                onClick={async () => {
                  setBusy(true)
                  const error = await buyItem(buying.id)
                  setBusy(false)
                  if (error) return toast(error, 'error')
                  toast(`${buying.name} is yours`)
                  setBuying(null)
                  navigate('/account')
                }}
                data-confirm-buy
              >
                <Coins className="size-4" /> Spend {n(buying.price)} coins
              </Button>
            </>
          }
        >
          <div className="space-y-3 p-6">
            <div className="overflow-hidden rounded-2xl border border-border">
              <LookPreview itemId={buying.id} name={account.username ?? 'You'} avatar={account.avatar} large />
            </div>
            <p className="text-sm text-muted">Coins that are spent can't be turned back into money.</p>
          </div>
        </Dialog>
      )}
    </div>
  )
}

type Entry = { id: number; kind: 'purchase' | 'spend' | 'refund' | 'chargeback' | 'reversal' | 'admin'; amount: number; note: string; at: number | null; paidCents: number | null; currency: string | null; status: string | null }
const KIND: Record<Entry['kind'], string> = { purchase: 'Bought', spend: 'Spent', refund: 'Refunded', chargeback: 'Payment disputed', reversal: 'Dispute settled', admin: 'From Vanity' }

/** Account → Purchase history: every time coins came or went, newest first. */
export function PurchasesPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [more, setMore] = useState(false)
  const [balance, setBalance] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (before?: number): Promise<void> => {
    setLoading(true)
    const r = await window.vanity.account.request<{ balance: number; entries: Entry[]; hasMore: boolean }>('GET', `/coins/history${before ? `?before=${before}` : ''}`).catch(() => null)
    setLoading(false)
    if (!r || r.error !== undefined) return setError(r?.error ?? "Couldn't load your purchases. Check your connection.")
    setBalance(r.data.balance)
    setMore(r.data.hasMore)
    setEntries((prev) => (before ? [...(prev ?? []), ...r.data.entries] : r.data.entries))
  }
  useEffect(() => void load(), [])

  return (
    <div className="h-full overflow-y-auto" data-purchases-page>
      <div className="stagger mx-auto w-full max-w-3xl space-y-5 px-10 pb-16 pt-12 max-md:px-4 max-md:pt-14">
        <button onClick={() => navigate('/account')} className="text-sm text-muted transition hover:text-text">
          ← Account
        </button>
        <div className="flex flex-wrap items-end gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Purchase history</h1>
          <span className="ml-auto flex items-center gap-1.5 text-sm font-semibold tabular-nums">
            <Coins className="size-4 text-amber-300" /> {n(balance)}
          </span>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
            {error}
          </p>
        )}
        {entries === null && !error ? (
          <div className="flex h-32 items-center justify-center text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : entries && entries.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted">
            Nothing here yet. <Link to="/coins" className="font-semibold text-accent">Get Coins</Link>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-border bg-surface" data-ledger>
            {entries?.map((e) => (
              <li key={e.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0" data-ledger-entry={e.kind}>
                <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', e.amount >= 0 ? 'bg-emerald-400/15 text-emerald-400' : 'bg-accent/15 text-accent')}>{e.amount >= 0 ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {KIND[e.kind]}
                    {e.note ? `: ${e.note}` : ''}
                  </span>
                  <span className="block text-xs text-muted">
                    {e.at ? new Date(e.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                    {e.paidCents !== null && e.currency ? ` · ${formatPrice(e.paidCents, e.currency)}` : ''}
                    {e.status && e.status !== 'paid' ? ` · ${e.status}` : ''}
                  </span>
                </span>
                <span className={cn('font-display text-lg font-bold tabular-nums', e.amount >= 0 ? 'text-emerald-400' : 'text-accent')}>
                  {e.amount > 0 ? '+' : ''}
                  {n(e.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {more && entries && (
          <div className="text-center">
            <Button onClick={() => void load(entries[entries.length - 1].id)} disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />} Show older
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
