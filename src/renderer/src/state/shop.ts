import { useEffect, useSyncExternalStore } from 'react'
import { setCoins, usePulse } from './pulse'

export interface CoinBundle {
  id: string
  coins: number
  priceCents: number
  tag?: string
}
export interface ShopItem {
  id: string
  price: number
  name: string
}
/** The coin store as the server describes it: prices live there, so they can change without an update. */
/** Vanity Plus: the monthly membership that includes every premium look. */
export interface PlusState {
  active: boolean
  /** Paying through Stripe (not a gift from an admin). */
  subscribed: boolean
  status: string
  renewsAt: number | null
  /** Cancelled: it runs until renewsAt and then stops. */
  endsAtPeriodEnd: boolean
  giftedUntil: number | null
  canManage: boolean
  name: string
  priceCents: number
  interval: string
}

export interface Shop {
  plus?: PlusState
  balance: number
  purchasesEnabled: boolean
  currency: string
  bundles: CoinBundle[]
  items: ShopItem[]
  owned: string[]
}

let current: Shop | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
const publish = (next: Shop | null): void => {
  current = next
  listeners.forEach((l) => l())
}

export function refreshShop(): Promise<void> {
  loading ??= window.vanity.account
    .request<Shop>('GET', '/coins')
    .then(
      (r) => {
        if (r.error === undefined) {
          publish(r.data)
          setCoins(r.data.balance)
        }
      },
      () => {}
    )
    .finally(() => (loading = null))
  return loading
}

/** Spends coins on something. Resolves with an error message, or null when it worked. */
export async function buyItem(itemId: string): Promise<string | null> {
  const r = await window.vanity.account.request<{ balance: number; owned: string[] }>('POST', '/coins/buy', { itemId }).catch(() => null)
  if (!r) return "Couldn't reach Vanity. Check your connection and try again."
  if (r.error !== undefined) return r.error
  setCoins(r.data.balance)
  if (current) publish({ ...current, balance: r.data.balance, owned: r.data.owned })
  return null
}

/** The store (null until it has loaded, or when signed out). Loads once, and again when the balance changes. */
export function useShop(on = true): Shop | null {
  const coins = usePulse().coins
  useEffect(() => {
    if (!on) return
    if (coins === null) return publish(null)
    if (!current || current.balance !== coins) void refreshShop()
  }, [on, coins])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}

/** "$4.99" for 499 cents of usd. */
export function formatPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}
