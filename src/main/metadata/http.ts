export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** The request reached the server, which answered with an error status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/** The request never got an answer: offline, DNS failure, timeout. */
export class NetworkError extends Error {}

const TIMEOUT_MS = 20_000

/** Waits so that calls through it are at least `minIntervalMs` apart (APIs rate-limit per second). */
export function createLimiter(minIntervalMs: number): <T>(task: () => Promise<T>) => Promise<T> {
  let next = 0
  return async (task) => {
    const now = Date.now()
    const wait = Math.max(0, next - now)
    next = Math.max(now, next) + minIntervalMs
    if (wait) await new Promise((r) => setTimeout(r, wait))
    return task()
  }
}

/** fetch with a timeout, turning failures into NetworkError / HttpError. Retries once on 429. */
export async function request(fetchFn: FetchFn, url: string, init: RequestInit = {}, label = 'request'): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'could not connect'
      throw new NetworkError(`${label} ${reason}`)
    }
    if (res.status === 429 && attempt === 0) {
      const retryAfter = Number(res.headers.get('retry-after')) || 1
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000))
      continue
    }
    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 200)
      } catch {
        // ignore
      }
      throw new HttpError(res.status, `${label} failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`)
    }
    return res
  }
}

export async function requestJson<T>(fetchFn: FetchFn, url: string, init?: RequestInit, label?: string): Promise<T> {
  const res = await request(fetchFn, url, init, label)
  try {
    return (await res.json()) as T
  } catch {
    throw new HttpError(res.status, `${label ?? 'request'} returned invalid JSON`)
  }
}
