import { mkdtempSync } from 'node:fs'
import { connect, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiscordStatus } from '@shared/types'
import { buildActivity, fit, LOGO } from '../activity'
import { DiscordPresence } from '../presence'
import { encodeFrame, FrameReader, ipcPaths, OP, openDiscordSocket } from '../rpc'

const game = { name: 'Elden Ring', startedAt: 1000, imageUrl: 'https://cdn/x.jpg' }
const music = { title: 'Nightcall', artist: 'Kavinsky', startedAt: 5000, durationMs: 258_000 }

describe('activity', () => {
  it('shows the game with its timer', () => {
    expect(buildActivity({ game, music: null })).toEqual({
      type: 0,
      details: 'Playing Elden Ring',
      timestamps: { start: 1000 },
      assets: { large_image: 'https://cdn/x.jpg', large_text: 'Elden Ring' },
      instance: false
    })
  })

  it('shows the song, its elapsed time and length', () => {
    expect(buildActivity({ game: null, music })).toMatchObject({
      type: 2,
      details: 'Listening to Nightcall',
      state: 'by Kavinsky',
      timestamps: { start: 5000, end: 263_000 },
      assets: { large_image: LOGO }
    })
  })

  it('layers the game over the song when doing both', () => {
    const a = buildActivity({ game: { ...game, imageUrl: null }, music })!
    expect(a).toMatchObject({ details: 'Playing Elden Ring', state: 'Listening to Nightcall · Kavinsky', timestamps: { start: 1000 } })
    expect(a.assets).toMatchObject({ large_image: LOGO, small_image: LOGO, small_text: 'Listening to Nightcall · Kavinsky' })
    expect(buildActivity({ game: null, music: null })).toBeNull()
  })

  it('keeps text within Discord limits', () => {
    expect(fit('x'.repeat(300))).toHaveLength(128)
    expect(fit('a').length).toBeGreaterThanOrEqual(2)
  })
})

describe('rpc framing', () => {
  it('round-trips frames split across chunks', () => {
    const a = encodeFrame(OP.frame, { cmd: 'X', n: 1 })
    const b = encodeFrame(OP.ping, { hi: 'é' })
    const all = Buffer.concat([a, b])
    const r = new FrameReader()
    expect(r.push(all.subarray(0, 5))).toEqual([])
    expect(r.push(all.subarray(5, a.length + 3))).toEqual([{ op: OP.frame, data: { cmd: 'X', n: 1 } }])
    expect(r.push(all.subarray(a.length + 3))).toEqual([{ op: OP.ping, data: { hi: 'é' } }])
  })

  it('knows where Discord listens', () => {
    expect(ipcPaths('win32')[0]).toBe('\\\\?\\pipe\\discord-ipc-0')
    expect(ipcPaths('linux', { XDG_RUNTIME_DIR: '/run/user/1000' })[0]).toBe('/run/user/1000/discord-ipc-0')
  })
})

/** A stand-in for the Discord app: accepts the handshake, says READY, and records every command. */
function fakeDiscord(closeWith?: { code: number; message: string }) {
  const dir = mkdtempSync(join(tmpdir(), 'vanity-discord-'))
  const path = join(dir, 'discord-ipc-0')
  const handshakes: unknown[] = []
  const commands: { cmd: string; args: { pid: number; activity?: Record<string, unknown> } }[] = []
  const sockets: Socket[] = []
  const server = createServer((s) => {
    sockets.push(s)
    const r = new FrameReader()
    s.on('data', (chunk) => {
      for (const f of r.push(chunk)) {
        if (f.op === OP.handshake) {
          handshakes.push(f.data)
          if (closeWith) s.end(encodeFrame(OP.close, closeWith))
          else s.write(encodeFrame(OP.frame, { cmd: 'DISPATCH', evt: 'READY', data: { user: { username: 'jordan', global_name: 'Jordan' } } }))
        } else if (f.op === OP.frame) commands.push(f.data as never)
      }
    })
    s.on('error', () => {})
  })
  const listening = new Promise<void>((r) => server.listen(path, r))
  return { path, handshakes, commands, sockets, listening, close: () => new Promise<void>((r) => server.close(() => r())) }
}

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
  vi.useRealTimers()
})

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25))
  expect(check()).toBe(true)
}

describe('DiscordPresence', () => {
  it('connects, shows the game and song, and clears when turned off', async () => {
    const discord = fakeDiscord()
    await discord.listening
    let enabled = true
    const statuses: DiscordStatus[] = []
    const p = new DiscordPresence({
      enabled: () => enabled,
      clientId: () => '123',
      onStatus: (s) => statuses.push(s),
      open: () => openDiscordSocket([join(discord.path, '..', 'missing-0'), discord.path], (path) => connect(path)),
      pid: 42
    })
    cleanups.push(() => p.dispose(), discord.close)

    p.setGame({ name: 'Elden Ring', startedAt: 1000, imageUrl: null })
    p.sync()
    await until(() => discord.commands.length >= 1)
    expect(discord.handshakes).toEqual([{ v: 1, client_id: '123' }])
    expect(statuses.at(-1)).toEqual({ state: 'connected', user: 'Jordan', error: null })
    expect(discord.commands[0]).toMatchObject({ cmd: 'SET_ACTIVITY', args: { pid: 42, activity: { details: 'Playing Elden Ring' } } })

    p.setMusic({ title: 'Nightcall', artist: null, startedAt: 2000, durationMs: null })
    await until(() => discord.commands.length >= 2)
    expect(discord.commands[1].args.activity).toMatchObject({ details: 'Playing Elden Ring', state: 'Listening to Nightcall' })

    enabled = false
    p.sync()
    await until(() => discord.commands.length >= 3)
    expect(discord.commands[2].args.activity).toBeUndefined() // cleared
    expect(statuses.at(-1)?.state).toBe('off')
  }, 20_000)

  it('explains a rejected application ID', async () => {
    const discord = fakeDiscord({ code: 4000, message: 'Invalid Client ID' })
    await discord.listening
    const statuses: DiscordStatus[] = []
    const p = new DiscordPresence({ enabled: () => true, clientId: () => '999', onStatus: (s) => statuses.push(s), open: () => openDiscordSocket([discord.path]) })
    cleanups.push(() => p.dispose(), discord.close)
    p.sync()
    await until(() => statuses.some((s) => s.state === 'unavailable'))
    expect(statuses.find((s) => s.state === 'unavailable')?.error).toMatch(/application ID/)
  })

  it('asks for an ID, and reports when Discord is not running', async () => {
    const statuses: DiscordStatus[] = []
    const noId = new DiscordPresence({ enabled: () => true, clientId: () => '', onStatus: (s) => statuses.push(s) })
    noId.sync()
    expect(statuses.at(-1)?.state).toBe('needs-id')
    const down = new DiscordPresence({ enabled: () => true, clientId: () => '1', onStatus: (s) => statuses.push(s), open: () => openDiscordSocket(['/nonexistent/discord-ipc-0']) })
    cleanups.push(() => down.dispose())
    down.sync()
    await until(() => statuses.at(-1)?.state === 'unavailable')
    expect(statuses.at(-1)?.error).toMatch(/isn't running/)
  })
})
