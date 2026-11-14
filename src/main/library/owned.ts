import type { GameSource, SteamGame } from '@shared/types'
import type { Kv } from '../db/kv'
import type { LibraryStore } from './store'

/** A game you own on a store, whether or not it is installed here. */
export interface OwnedEntry {
  externalId: string
  name: string
  /** Artwork straight from the store's own servers (no look-up needed). */
  coverUrl: string | null
  heroUrl: string | null
}

/** Steam lists some things that aren't games; the same ones the Steam scanner skips. */
const NOT_A_GAME = /^(proton\b|steam linux runtime|steamworks common redistributables|steamvr\b|wallpaper engine$)/i

export function steamOwnedEntries(games: SteamGame[]): OwnedEntry[] {
  return games
    .filter((g) => Number.isInteger(g.appId) && g.appId > 0 && g.name.trim() && !NOT_A_GAME.test(g.name))
    .map((g) => ({
      externalId: String(g.appId),
      name: g.name.trim(),
      coverUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${g.appId}/library_600x900.jpg`,
      heroUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${g.appId}/library_hero.jpg`
    }))
}

const key = (source: GameSource): string => `library:owned:${source}`

/**
 * Keeps the library's "owned but not installed" games in step with what your linked accounts own.
 * The last list from each store is remembered, so it can be applied again after every scan
 * (a scan may find that an owned game was just installed, or uninstalled).
 */
export class OwnedGames {
  constructor(
    private store: LibraryStore,
    private kv: Kv,
    private onChange: () => void
  ) {}

  /** A fresh list from a store. Null: the account was unlinked, or isn't sharing its games. */
  set(source: GameSource, entries: OwnedEntry[] | null): void {
    if (entries) this.kv.set(key(source), entries)
    else this.kv.delete(key(source))
    this.apply(source)
  }

  /** Applies the remembered lists again (call after a scan). */
  reapply(): void {
    this.apply('steam')
  }

  private apply(source: GameSource): void {
    const entries = this.kv.get<OwnedEntry[]>(key(source))
    const changed = entries ? this.store.syncOwned(source, entries) : this.store.clearOwned(source)
    if (changed) this.onChange()
  }
}
