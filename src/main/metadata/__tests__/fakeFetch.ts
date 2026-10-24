import type { FetchFn } from '../http'

export interface Call {
  url: string
  method: string
  body: string | null
  headers: Record<string, string>
}

type Handler = (call: Call) => Response | Promise<Response> | undefined

/** A fetch that routes requests to handlers and records them. Unhandled requests get a 404. */
export function fakeFetch(handlers: Handler[]): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = []
  const fetch: FetchFn = async (url, init = {}) => {
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? init.body : null,
      headers: Object.fromEntries(new Headers(init.headers).entries())
    }
    calls.push(call)
    for (const h of handlers) {
      const res = await h(call)
      if (res) return res
    }
    return new Response('not found', { status: 404 })
  }
  return { fetch, calls }
}

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

export const image = (type = 'image/png'): Response =>
  new Response(new Uint8Array([137, 80, 78, 71, 1, 2, 3]), { status: 200, headers: { 'content-type': type } })
