// Vanity Coins: what is for sale, and for how much. THIS IS THE FILE TO EDIT to change prices.
// After changing it, push: the "Deploy backend" workflow puts it live, and every running copy of
// Vanity shows the new prices the next time the store is opened. No app update is needed.
//
// The app never decides how many coins someone gets: it only names a bundle id, and this file
// (on the server) says what that bundle is.

export interface CoinBundle {
  /** Never reuse an id for a different bundle: past purchases refer to it. */
  id: string
  coins: number
  /** The price in the smallest unit of the currency (499 = $4.99). */
  priceCents: number
  /** Shown on the bundle, e.g. "Most popular". Optional. */
  tag?: string
}

/** Three-letter currency code, lower case, as Stripe wants it. */
export const COIN_CURRENCY = 'usd'

export const COIN_BUNDLES: CoinBundle[] = [
  { id: 'coins-500', coins: 500, priceCents: 499 },
  { id: 'coins-1200', coins: 1200, priceCents: 999, tag: 'Most popular' },
  { id: 'coins-2500', coins: 2500, priceCents: 1999 },
  { id: 'coins-6500', coins: 6500, priceCents: 4999, tag: 'Best value' }
]

/**
 * Vanity Plus: a monthly membership (a Stripe subscription). While it is active, everything in
 * SHOP_ITEMS below is included, with nothing to buy. Change the price here; people already
 * subscribed keep the price they signed up at until they cancel and join again.
 */
export const VANITY_PLUS = {
  name: 'Vanity Plus',
  /** In the smallest unit of COIN_CURRENCY (500 = $5.00). */
  priceCents: 500,
  interval: 'month' as const
}

/**
 * Things that cost coins. For now: premium profile looks. The id is "<part>:<look id>", where the
 * look id is one from profileStyle.ts. Everything not listed here is free.
 * Later, items for Vanity's own games go in this list too, under their own prefix ("game:…").
 */
export const SHOP_ITEMS: Record<string, { price: number; name: string }> = {
  'banner:obsidian': { price: 500, name: 'Obsidian banner' },
  'banner:hologram': { price: 500, name: 'Hologram banner' },
  'banner:dragonfire': { price: 500, name: 'Dragonfire banner' },
  'frame:diamond': { price: 400, name: 'Diamond frame' },
  'frame:inferno': { price: 400, name: 'Inferno frame' },
  'frame:celestial': { price: 400, name: 'Celestial frame' },
  'aura:vortex': { price: 600, name: 'Vortex aura' },
  'aura:lightning': { price: 600, name: 'Lightning aura' },
  'nameStyle:chrome': { price: 300, name: 'Chrome name' },
  'nameStyle:hologram': { price: 300, name: 'Hologram name' },
  'effect:meteors': { price: 400, name: 'Meteors banner effect' },
  'title:High roller': { price: 150, name: '"High roller" title' },
  'title:Vanity VIP': { price: 150, name: '"Vanity VIP" title' },
  'title:Legend': { price: 150, name: '"Legend" title' }
}
