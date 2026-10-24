import type { StoreLauncher, StoreLink } from '@shared/types'

/**
 * Everything Vanity knows about one store/launcher. To support a new
 * launcher, add an entry to LAUNCHERS (and its label in STORE_LABELS).
 */
export interface LauncherDef {
  id: StoreLauncher
  /** URI scheme the launcher registers on Windows; used to detect whether it is installed. */
  protocol: string | null
  /** Web hosts its store pages live on. Only these are opened as web fallbacks. */
  hosts: RegExp
  /** Extracts the store ID from a store page URL, or null if the URL isn't this store's game page. */
  idFromUrl(url: URL): string | null
  /** The store page on the web for an ID (used when a URL wasn't provided). */
  webUrl(id: string): string
  /** URI that opens the launcher on the game's store page, or null if the launcher has none. */
  deepLink(id: string, context: { slug?: string }): string | null
}

/** Battle.net opens a game's page from its product code; there is no public lookup, so a few are listed. */
const BATTLENET_CODES: Record<string, string> = {
  'world-of-warcraft': 'WoW',
  'overwatch-2': 'Pro',
  'diablo-iv': 'Fen',
  'diablo-iii': 'D3',
  hearthstone: 'WTCG',
  'starcraft-ii': 'S2',
  'heroes-of-the-storm': 'Hero'
}

const firstMatch = (re: RegExp, s: string): string | null => re.exec(s)?.[1] ?? null

export const LAUNCHERS: Record<StoreLauncher, LauncherDef> = {
  steam: {
    id: 'steam',
    protocol: 'steam',
    hosts: /^store\.steampowered\.com$/,
    idFromUrl: (u) => firstMatch(/^\/app\/(\d+)/, u.pathname),
    webUrl: (id) => `https://store.steampowered.com/app/${id}`,
    deepLink: (id) => (/^\d+$/.test(id) ? `steam://store/${id}` : null)
  },
  epic: {
    id: 'epic',
    protocol: 'com.epicgames.launcher',
    hosts: /^(store\.|www\.)?epicgames\.com$/,
    // store.epicgames.com/en-US/p/fortnite, or the older epicgames.com/store/en-US/product/fortnite/home
    idFromUrl: (u) => firstMatch(/^\/(?:store\/)?(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?(?:p|product)\/([^/?#]+)/, u.pathname),
    webUrl: (slug) => `https://store.epicgames.com/p/${slug}`,
    deepLink: (slug) => `com.epicgames.launcher://store/p/${encodeURIComponent(slug)}`
  },
  gog: {
    id: 'gog',
    protocol: 'goggalaxy',
    hosts: /^(www\.)?gog\.com$/,
    idFromUrl: (u) => firstMatch(/^\/(?:[a-z]{2}\/)?game\/([^/?#]+)/, u.pathname),
    // gog.com pages are addressed by slug; aggregate.ts keeps the page URL alongside a numeric ID.
    webUrl: (slug) => `https://www.gog.com/game/${slug}`,
    // Galaxy needs the numeric product ID; a slug from a URL isn't enough.
    deepLink: (id) => (/^\d+$/.test(id) ? `goggalaxy://openGameView/${id}` : null)
  },
  ea: {
    id: 'ea',
    protocol: 'link2ea',
    hosts: /^(www\.)?ea\.com$/,
    idFromUrl: (u) => firstMatch(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?games\/(.+?)\/?$/, u.pathname),
    webUrl: (path) => `https://www.ea.com/games/${path}`,
    // The EA app has no documented store-page link, so EA games open in the browser.
    deepLink: () => null
  },
  ubisoft: {
    id: 'ubisoft',
    protocol: 'uplay',
    hosts: /^(store\.)?ubisoft\.com$|^(www\.)?ubisoft\.com$/,
    idFromUrl: (u) => (u.pathname.length > 1 ? u.pathname.replace(/^\/|\/$/g, '') : null),
    webUrl: (path) => `https://store.ubisoft.com/${path}`,
    // Ubisoft Connect's uplay:// links launch installed games but don't open store pages.
    deepLink: () => null
  },
  battlenet: {
    id: 'battlenet',
    protocol: 'battlenet',
    hosts: /^(shop\.|us\.shop\.|eu\.shop\.)?battle\.net$|^(www\.)?blizzard\.com$/,
    idFromUrl: (u) => (u.pathname.length > 1 ? u.pathname.replace(/^\/|\/$/g, '') : null),
    webUrl: (path) => `https://shop.battle.net/${path}`,
    deepLink: (_id, { slug }) => (slug && BATTLENET_CODES[slug] ? `battlenet://${BATTLENET_CODES[slug]}` : null)
  },
  microsoft: {
    id: 'microsoft',
    protocol: 'ms-windows-store',
    hosts: /^(apps\.|www\.)?microsoft\.com$|^(www\.)?xbox\.com$/,
    // Product IDs look like 9NBLGGH4R315 (12 characters) at the end of the path.
    idFromUrl: (u) => firstMatch(/\/([0-9A-Za-z]{12})(?:\/|$)/, u.pathname)?.toUpperCase() ?? null,
    webUrl: (id) => `https://apps.microsoft.com/detail/${id}`,
    deepLink: (id) => (/^[0-9A-Z]{12}$/.test(id) ? `ms-windows-store://pdp/?productid=${id}` : null)
  }
}

export const ALL_LAUNCHERS = Object.keys(LAUNCHERS) as StoreLauncher[]

function parse(url: string): URL | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null
  } catch {
    return null
  }
}

/** Which store a URL belongs to, and the game's ID there. */
export function storeFromUrl(url: string): { launcher: StoreLauncher; id: string; webUrl: string } | null {
  const u = parse(url)
  if (!u) return null
  const host = u.hostname.toLowerCase()
  for (const def of Object.values(LAUNCHERS)) {
    if (!def.hosts.test(host)) continue
    const id = def.idFromUrl(u)
    if (id) return { launcher: def.id, id, webUrl: `https://${u.host}${u.pathname}` }
  }
  return null
}

/** True if a URL is an https page on one of the launcher's own store hosts (safe to open as a fallback). */
export function isStoreWebUrl(launcher: StoreLauncher, url: string): boolean {
  const u = parse(url)
  return !!u && u.protocol === 'https:' && LAUNCHERS[launcher].hosts.test(u.hostname.toLowerCase())
}

export function buildStoreLink(launcher: StoreLauncher, storeId: string | null, webUrl: string | null, slug?: string): StoreLink {
  const def = LAUNCHERS[launcher]
  return {
    launcher,
    storeId,
    deepLink: storeId ? def.deepLink(storeId, { slug }) : null,
    webUrl: webUrl ?? (storeId ? def.webUrl(storeId) : '')
  }
}

export interface OpenDeps {
  /** True if a launcher's protocol is registered on this PC. */
  isInstalled(launcher: StoreLauncher): boolean
  openExternal(url: string): Promise<void>
}

/**
 * Opens a store page: in the launcher if it's installed and has a deep link,
 * otherwise (or if that fails) in the browser. Only a deep link using the
 * launcher's own protocol, and a web URL on its own store hosts, are opened.
 */
export async function openStore(link: StoreLink, deps: OpenDeps): Promise<'launcher' | 'browser'> {
  const def = LAUNCHERS[link.launcher]
  if (!def) throw new Error('Unknown launcher.')
  const deep = link.deepLink && def.protocol && link.deepLink.startsWith(`${def.protocol}://`) ? link.deepLink : null
  const web = isStoreWebUrl(link.launcher, link.webUrl) ? link.webUrl : link.storeId ? def.webUrl(link.storeId) : null
  if (deep && deps.isInstalled(link.launcher)) {
    try {
      await deps.openExternal(deep)
      return 'launcher'
    } catch {
      // Fall through to the browser.
    }
  }
  if (!web) throw new Error("This game's store page isn't known.")
  await deps.openExternal(web)
  return 'browser'
}
