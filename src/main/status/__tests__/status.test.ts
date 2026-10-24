import { describe, expect, it, vi } from 'vitest'
import type { LauncherStatus } from '@shared/types'
import type { FetchFn } from '../../metadata/http'
import { fakeFetch, json } from '../../metadata/__tests__/fakeFetch'
import { probe, STATUS_CHECKS, statuspage } from '../checks'
import { StatusService } from '../service'

describe('status checks', () => {
  it('Steam is online when its API answers with the server time', async () => {
    const up = fakeFetch([(c) => (c.url.includes('GetServerInfo') ? json({ servertime: 1792800000 }) : undefined)])
    expect(await STATUS_CHECKS.steam(up.fetch)).toEqual({ online: true, detail: null })
    const down = fakeFetch([() => new Response('', { status: 503 })])
    expect((await STATUS_CHECKS.steam(down.fetch)).online).toBe(false)
  })

  it('reads Statuspage indicators', async () => {
    const page = (indicator: string, description: string) => fakeFetch([() => json({ status: { indicator, description } })]).fetch
    const check = statuspage('https://status.example/api/v2/status.json')
    expect(await check(page('none', 'All Systems Operational'))).toEqual({ online: true, detail: null })
    expect(await check(page('minor', 'Minor Service Outage'))).toEqual({ online: true, detail: 'Minor Service Outage' })
    expect(await check(page('major', 'Major Service Outage'))).toEqual({ online: false, detail: 'Major Service Outage' })
  })

  it('treats any answer below 500 as reachable, including 403', async () => {
    const check = probe('https://www.example.com/')
    expect((await check(fakeFetch([() => new Response('', { status: 403 })]).fetch)).online).toBe(true)
    expect((await check(fakeFetch([() => new Response('', { status: 502 })]).fetch)).online).toBe(false)
    const offline: FetchFn = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await check(offline)).toEqual({ online: false, detail: "Couldn't connect" })
  })

  it('retries with GET when HEAD is not allowed', async () => {
    const { fetch, calls } = fakeFetch([(c) => (c.method === 'HEAD' ? new Response('', { status: 405 }) : new Response('ok'))])
    expect((await probe('https://x/')(fetch)).online).toBe(true)
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET'])
  })
})

describe('StatusService', () => {
  it('starts unknown, then reports each launcher and never throws', async () => {
    const updates: LauncherStatus[][] = []
    const service = new StatusService({
      fetchFn: fakeFetch([]).fetch,
      onUpdate: (s) => updates.push(s),
      now: () => 42,
      checks: {
        steam: async () => ({ online: true, detail: null }),
        epic: async () => {
          throw new Error('boom')
        }
      }
    })
    expect(service.get().map((s) => s.state)).toEqual(['unknown', 'unknown'])
    await service.check()
    expect(service.get()).toEqual([
      { launcher: 'steam', state: 'online', detail: null, checkedAt: 42 },
      { launcher: 'epic', state: 'offline', detail: "Couldn't connect", checkedAt: 42 }
    ])
    expect(updates).toHaveLength(1)
  })

  it('rechecks on a timer', async () => {
    vi.useFakeTimers()
    try {
      const check = vi.fn(async () => ({ online: true, detail: null }))
      const service = new StatusService({ fetchFn: fakeFetch([]).fetch, onUpdate: () => {}, checks: { steam: check } })
      service.start()
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 100)
      expect(check).toHaveBeenCalledTimes(2)
      service.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
