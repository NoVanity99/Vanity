import { VOICE_PROTOCOL, type VoiceClientMessage, type VoiceServerMessage } from '@shared/voiceProtocol'
import { backoffMs } from './detect'

export type SignalingStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface SignalingOptions {
  url: string
  /** A fresh sign-in token for each connection (they run out after a few minutes). */
  token(): Promise<string>
  onMessage(msg: VoiceServerMessage): void
  onStatus(status: SignalingStatus, attempt: number): void
  /** Called after the server said welcome, every time (first connect and each reconnect). */
  onWelcome(msg: Extract<VoiceServerMessage, { t: 'welcome' }>): void
  /** Errors that end the session (signed out, wrong version, replaced): no more reconnecting. */
  onFatal(msg: Extract<VoiceServerMessage, { t: 'error' }>): void
}

const FATAL = new Set(['auth', 'version', 'replaced'])

/**
 * The connection to the voice server. It reconnects by itself after a drop (waiting a little
 * longer each time), says hello again with a new token, and reports round-trip time.
 */
export class SignalingClient {
  private ws: WebSocket | null = null
  private attempt = 0
  private stopped = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private welcomed = false
  /** Round trip to the server (ms), from the last ping. */
  rtt: number | null = null

  constructor(private opts: SignalingOptions) {}

  get open(): boolean {
    return this.welcomed && this.ws?.readyState === WebSocket.OPEN
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  private connect(): void {
    if (this.stopped) return
    this.opts.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting', this.attempt)
    let ws: WebSocket
    try {
      ws = new WebSocket(this.opts.url)
    } catch {
      return this.retry()
    }
    this.ws = ws
    this.welcomed = false
    // A server that never answers counts as a failed attempt.
    const openTimer = setTimeout(() => ws.readyState !== WebSocket.OPEN && ws.close(), 10_000)
    ws.onopen = async () => {
      clearTimeout(openTimer)
      let token = ''
      try {
        token = await this.opts.token()
      } catch {
        // Signed out: the server will say so.
      }
      if (ws.readyState === WebSocket.OPEN) this.sendOn(ws, { t: 'hello', v: VOICE_PROTOCOL, token })
    }
    ws.onmessage = (e) => {
      let msg: VoiceServerMessage
      try {
        msg = JSON.parse(String(e.data)) as VoiceServerMessage
      } catch {
        return
      }
      if (msg.t === 'welcome') {
        this.welcomed = true
        this.attempt = 0
        this.opts.onStatus('open', 0)
        this.startPing()
        return this.opts.onWelcome(msg)
      }
      if (msg.t === 'pong') {
        this.rtt = Math.max(0, Math.round(performance.now() - msg.at))
        return
      }
      if (msg.t === 'error' && FATAL.has(msg.code)) {
        this.stop()
        return this.opts.onFatal(msg)
      }
      this.opts.onMessage(msg)
    }
    ws.onclose = () => {
      clearTimeout(openTimer)
      this.stopPing()
      if (this.ws === ws) this.ws = null
      this.welcomed = false
      if (!this.stopped) this.retry()
    }
    ws.onerror = () => {
      // onclose follows and handles it.
    }
  }

  private retry(): void {
    if (this.stopped) return
    this.attempt++
    this.opts.onStatus('reconnecting', this.attempt)
    this.retryTimer = setTimeout(() => this.connect(), backoffMs(this.attempt - 1))
  }

  /** Try again now instead of waiting (the "Reconnect" button, or the network coming back). */
  retryNow(): void {
    if (this.stopped || this.open) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return
    this.connect()
  }

  private startPing(): void {
    this.stopPing()
    const ping = (): void => void this.send({ t: 'ping', at: performance.now() })
    ping()
    this.pingTimer = setInterval(ping, 5000)
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private sendOn(ws: WebSocket, msg: VoiceClientMessage): void {
    ws.send(JSON.stringify(msg))
  }

  /** Sends if connected; returns false otherwise (the caller resends what matters after a reconnect). */
  send(msg: VoiceClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN || (!this.welcomed && msg.t !== 'hello')) return false
    this.sendOn(this.ws, msg)
    return true
  }

  stop(): void {
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.stopPing()
    const ws = this.ws
    this.ws = null
    this.welcomed = false
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, 'bye')
    this.opts.onStatus('closed', 0)
  }
}
