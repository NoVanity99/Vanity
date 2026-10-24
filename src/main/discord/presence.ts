import { randomUUID } from 'node:crypto'
import type { Socket } from 'node:net'
import type { DiscordStatus } from '@shared/types'
import { buildActivity, type Activity, type PresenceInput } from './activity'
import { encodeFrame, FrameReader, OP, openDiscordSocket } from './rpc'

const RETRY_MS = 15_000
/** Discord allows about 5 activity updates per 20 seconds; stay well under it. */
const MIN_SEND_GAP_MS = 4_000

export interface PresenceDeps {
  enabled(): boolean
  clientId(): string
  onStatus(status: DiscordStatus): void
  open?: () => Promise<Socket>
  pid?: number
  now?: () => number
}

/**
 * Shows what you're doing in Vanity on your Discord profile. Connects to the
 * Discord app on this PC (nothing goes through the internet from Vanity),
 * reconnects when Discord restarts, and clears the status when turned off.
 */
export class DiscordPresence {
  private input: PresenceInput = { game: null, music: null }
  private socket: Socket | null = null
  private ready = false
  private connecting = false
  private retry: ReturnType<typeof setTimeout> | null = null
  private pending: ReturnType<typeof setTimeout> | null = null
  private lastSent: string | null = null
  private lastSentAt = 0
  private status: DiscordStatus = { state: 'off', user: null, error: null }
  private readonly now: () => number

  constructor(private deps: PresenceDeps) {
    this.now = deps.now ?? Date.now
  }

  getStatus(): DiscordStatus {
    return { ...this.status }
  }

  private setStatus(patch: Partial<DiscordStatus>): void {
    this.status = { ...this.status, ...patch }
    this.deps.onStatus(this.getStatus())
  }

  setGame(game: PresenceInput['game']): void {
    this.input = { ...this.input, game }
    this.schedule()
  }

  setMusic(music: PresenceInput['music']): void {
    this.input = { ...this.input, music }
    this.schedule()
  }

  /** Call after the setting changes: connects, or clears the status and disconnects. */
  sync(): void {
    if (!this.deps.enabled()) {
      this.disconnect(true)
      this.setStatus({ state: 'off', user: null, error: null })
      return
    }
    if (!this.deps.clientId()) {
      this.disconnect(false)
      this.setStatus({ state: 'needs-id', user: null, error: null })
      return
    }
    if (this.ready) this.schedule()
    else void this.connect()
  }

  dispose(): void {
    this.disconnect(true)
  }

  private async connect(): Promise<void> {
    if (this.connecting || this.socket) return
    this.connecting = true
    this.clearRetry()
    if (this.status.state !== 'connected') this.setStatus({ state: 'connecting', error: null })
    try {
      const socket = await (this.deps.open ?? (() => openDiscordSocket()))()
      if (!this.deps.enabled()) {
        socket.destroy()
        return
      }
      this.socket = socket
      const reader = new FrameReader()
      socket.on('data', (chunk: Buffer) => {
        for (const f of reader.push(chunk)) this.onFrame(f.op, f.data as Record<string, unknown> | null)
      })
      socket.on('close', () => this.onClosed())
      socket.on('error', () => {})
      socket.write(encodeFrame(OP.handshake, { v: 1, client_id: this.deps.clientId() }))
    } catch {
      this.setStatus({ state: 'unavailable', user: null, error: "Discord isn't running on this PC." })
      this.scheduleRetry()
    } finally {
      this.connecting = false
    }
  }

  private onFrame(op: number, data: Record<string, unknown> | null): void {
    if (op === OP.ping) {
      this.socket?.write(encodeFrame(OP.pong, data))
      return
    }
    if (op === OP.close) {
      const message = typeof data?.message === 'string' ? data.message : 'Discord closed the connection.'
      // 4000: unknown application ID.
      const badId = data?.code === 4000 || /client id/i.test(message)
      this.setStatus({ state: 'unavailable', user: null, error: badId ? 'Discord rejected the application ID. Check it in Settings.' : message })
      this.socket?.destroy()
      return
    }
    if (op !== OP.frame || !data) return
    if (data.evt === 'READY') {
      const user = (data.data as { user?: { global_name?: string; username?: string } } | undefined)?.user
      this.ready = true
      this.lastSent = null
      this.setStatus({ state: 'connected', user: user?.global_name || user?.username || null, error: null })
      this.schedule(0)
    } else if (data.evt === 'ERROR') {
      const message = (data.data as { message?: string } | undefined)?.message
      if (message) this.setStatus({ error: message })
    }
  }

  private onClosed(): void {
    const wasReady = this.ready
    this.socket = null
    this.ready = false
    if (!this.deps.enabled() || !this.deps.clientId()) return
    if (wasReady || this.status.state === 'connecting') this.setStatus({ state: 'unavailable', user: null, error: this.status.error ?? 'Lost the connection to Discord.' })
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    this.clearRetry()
    this.retry = setTimeout(() => {
      this.retry = null
      if (this.deps.enabled() && this.deps.clientId()) void this.connect()
    }, RETRY_MS)
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
  }

  /** Sends the current activity soon, batching quick changes and respecting Discord's rate limit. */
  private schedule(delay?: number): void {
    if (!this.ready) return
    if (this.pending) clearTimeout(this.pending)
    const wait = delay ?? Math.max(500, this.lastSentAt + MIN_SEND_GAP_MS - this.now())
    this.pending = setTimeout(() => {
      this.pending = null
      this.send(buildActivity(this.input))
    }, wait)
  }

  private send(activity: Activity | null): void {
    if (!this.socket || !this.ready) return
    const key = JSON.stringify(activity)
    if (key === this.lastSent) return
    this.lastSent = key
    this.lastSentAt = this.now()
    this.socket.write(
      encodeFrame(OP.frame, { cmd: 'SET_ACTIVITY', args: { pid: this.deps.pid ?? process.pid, ...(activity ? { activity } : {}) }, nonce: randomUUID() })
    )
  }

  private disconnect(clear: boolean): void {
    this.clearRetry()
    if (this.pending) clearTimeout(this.pending)
    this.pending = null
    const socket = this.socket
    if (!socket) return
    if (clear && this.ready) this.send(null)
    this.socket = null
    this.ready = false
    this.lastSent = null
    socket.end()
  }
}
