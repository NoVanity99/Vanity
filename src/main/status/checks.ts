import type { StoreLauncher } from '@shared/types'
import type { FetchFn } from '../metadata/http'

export interface CheckResult {
  online: boolean
  detail: string | null
}

const TIMEOUT_MS = 10_000

async function get(fetchFn: FetchFn, url: string, method = 'GET'): Promise<Response> {
  return fetchFn(url, { method, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'Cache-Control': 'no-cache' } })
}

/**
 * Reachability: any HTTP answer below 500 means the service is up (sites
 * often answer bots with 403, which still proves they're there).
 */
export function probe(url: string): (fetchFn: FetchFn) => Promise<CheckResult> {
  return async (fetchFn) => {
    try {
      let res = await get(fetchFn, url, 'HEAD')
      // Some servers don't do HEAD; ask again with GET before calling it down.
      if (res.status === 405 || res.status >= 500) res = await get(fetchFn, url)
      return res.status < 500 ? { online: true, detail: null } : { online: false, detail: `Server error (HTTP ${res.status})` }
    } catch {
      return { online: false, detail: "Couldn't connect" }
    }
  }
}

/** Atlassian Statuspage (used by Epic): "none"/"minor" = up, "major"/"critical" = down. */
export function statuspage(url: string): (fetchFn: FetchFn) => Promise<CheckResult> {
  return async (fetchFn) => {
    try {
      const res = await get(fetchFn, url)
      if (!res.ok) return { online: false, detail: `Status page error (HTTP ${res.status})` }
      const body = (await res.json()) as { status?: { indicator?: string; description?: string } }
      const indicator = body.status?.indicator ?? 'none'
      return {
        online: indicator === 'none' || indicator === 'minor',
        detail: indicator === 'none' ? null : (body.status?.description ?? indicator)
      }
    } catch {
      return { online: false, detail: "Couldn't connect" }
    }
  }
}

/** Steam: its Web API answers with the server time when it's up. */
async function steam(fetchFn: FetchFn): Promise<CheckResult> {
  try {
    const res = await get(fetchFn, 'https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/')
    if (!res.ok) return { online: false, detail: `Steam API error (HTTP ${res.status})` }
    const body = (await res.json()) as { servertime?: number }
    return body.servertime ? { online: true, detail: null } : { online: false, detail: 'Unexpected response' }
  } catch {
    return { online: false, detail: "Couldn't connect" }
  }
}

/** How each launcher's status is checked. Add a launcher here to show it in the status bar. */
export const STATUS_CHECKS: Record<StoreLauncher, (fetchFn: FetchFn) => Promise<CheckResult>> = {
  steam,
  epic: statuspage('https://status.epicgames.com/api/v2/status.json'),
  ea: probe('https://www.ea.com/'),
  ubisoft: probe('https://store.ubisoft.com/'),
  battlenet: probe('https://shop.battle.net/'),
  gog: probe('https://www.gog.com/'),
  microsoft: probe('https://apps.microsoft.com/')
}
