// End to end: the app's AccountService talking to this server (real routes, real SQL on PGlite).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Sql } from '../src/db'
import { AccountService } from '../../src/main/account/service'
import { gameKey } from '../../src/main/account/gameKey'

async function server() {
  const db = new PGlite()
  await db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8'))
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return (await db.query(text, values)).rows as never
  }
  const app = createApp({ sql, jwtSecret: 'x'.repeat(40), authRateLimit: 1000 })
  const fetchFn = async (url: string, init?: RequestInit) => app.request(url.replace('http://vanity.test', ''), init)
  return { fetchFn }
}

/** A Vanity app instance with its own settings and a tiny fake library. */
function vanity(fetchFn: (url: string, init?: RequestInit) => Promise<Response>, games: { id: number; name: string; playtimeSeconds: number; lastPlayedAt: number | null }[]) {
  let settings: Record<string, unknown> = { accountServerUrl: '', accountToken: '', accountUsername: '' }
  let running: { id: number; startedAt: number } | null = null
  const store = { list: () => games, get: (id: number) => games.find((g) => g.id === id) ?? null }
  const service = new AccountService({
    store: store as never,
    fetchFn,
    getSettings: () => settings as never,
    saveSettings: async (patch) => (settings = { ...settings, ...patch }) as never,
    serverUrl: () => String(settings.accountServerUrl),
    runningGame: () => running,
    onChange: () => {}
  })
  return { service, play: (r: typeof running) => (running = r), settings: () => settings }
}

describe('app ↔ server', () => {
  it('signs up two players, makes them friends, and shares presence and stats', async () => {
    const { fetchFn } = await server()
    const me = vanity(fetchFn, [{ id: 1, name: 'Portal 2', playtimeSeconds: 7200, lastPlayedAt: Date.now() }])
    const friend = vanity(fetchFn, [
      { id: 1, name: 'Portal 2', playtimeSeconds: 3600, lastPlayedAt: Date.now() },
      { id: 2, name: 'The Witcher® 3: Wild Hunt', playtimeSeconds: 90000, lastPlayedAt: Date.now() }
    ])

    await expect(me.service.setServer('not a url')).rejects.toThrow(/full address/)
    expect(await me.service.setServer('http://vanity.test/')).toMatchObject({ serverConfigured: true, serverUrl: 'http://vanity.test', signedIn: false })
    await friend.service.setServer('http://vanity.test')

    expect(await me.service.register('jordan', 'correct horse')).toMatchObject({ signedIn: true, username: 'jordan' })
    await friend.service.register('sam', 'battery staple')
    me.service.stop()
    friend.service.stop()

    await me.service.guard((c) => c.addFriend('sam'))
    const req = await friend.service.guard((c) => c.friends())
    await friend.service.guard((c) => c.accept(req.incoming[0].id))

    friend.play({ id: 2, startedAt: Date.now() - 5 * 60_000 })
    await friend.service.heartbeat()
    await friend.service.syncStats()
    await me.service.syncStats()

    const list = await me.service.guard((c) => c.friends())
    expect(list.friends[0]).toMatchObject({
      username: 'sam',
      status: { state: 'playing', gameName: 'The Witcher® 3: Wild Hunt' },
      totalPlaytimeSeconds: 93600,
      topGame: 'The Witcher® 3: Wild Hunt'
    })
    // Same game key regardless of punctuation or store.
    const whoPlayed = await me.service.guard((c) => c.gameFriends(gameKey('The Witcher 3 - Wild Hunt')))
    expect(whoPlayed.map((f) => f.username)).toEqual(['sam'])

    await friend.service.logout()
    expect((await me.service.guard((c) => c.friends())).friends[0].status.state).toBe('offline')
  })

  it('signs out locally when the server says the session is gone', async () => {
    const { fetchFn } = await server()
    const app = vanity(fetchFn, [])
    await app.service.setServer('http://vanity.test')
    await app.service.register('temp_user', 'longpassword')
    app.service.stop()
    await app.service.deleteAccount()
    expect(app.service.state().signedIn).toBe(false)
    await expect(app.service.login('temp_user', 'longpassword')).rejects.toThrow(/Wrong username or password/)
  })

  it('explains an unreachable server', async () => {
    const offline = vanity(async () => {
      throw new TypeError('fetch failed')
    }, [])
    await expect(offline.service.setServer('https://nowhere.example')).rejects.toThrow(/Couldn't reach the Vanity server/)
  })
})
