import { connect, type Socket } from 'node:net'
import { join } from 'node:path'

// Discord's local RPC: a named pipe (Windows) or Unix socket, carrying frames of
// [opcode: int32 LE][length: int32 LE][JSON]. See discord.com/developers/docs/topics/rpc.

export const OP = { handshake: 0, frame: 1, close: 2, ping: 3, pong: 4 } as const

export function encodeFrame(op: number, payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.alloc(8)
  header.writeInt32LE(op, 0)
  header.writeInt32LE(json.length, 4)
  return Buffer.concat([header, json])
}

/** Splits a byte stream into frames; keeps any incomplete tail for next time. */
export class FrameReader {
  private buf = Buffer.alloc(0)
  push(chunk: Buffer): { op: number; data: unknown }[] {
    this.buf = Buffer.concat([this.buf, chunk])
    const out: { op: number; data: unknown }[] = []
    while (this.buf.length >= 8) {
      const len = this.buf.readInt32LE(4)
      if (this.buf.length < 8 + len) break
      const op = this.buf.readInt32LE(0)
      let data: unknown = null
      try {
        data = JSON.parse(this.buf.subarray(8, 8 + len).toString('utf8'))
      } catch {
        // Ignore a malformed frame.
      }
      out.push({ op, data })
      this.buf = this.buf.subarray(8 + len)
    }
    return out
  }
}

/** Where Discord listens: discord-ipc-0 … 9. */
export function ipcPaths(platform = process.platform, env = process.env): string[] {
  if (platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`)
  const base = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp'
  // Flatpak and Snap Discord put the socket in a subfolder.
  const dirs = [base, join(base, 'app/com.discordapp.Discord'), join(base, 'snap.discord')]
  return dirs.flatMap((d) => Array.from({ length: 10 }, (_, i) => join(d, `discord-ipc-${i}`)))
}

export type Connector = (path: string) => Socket

/** Opens the first Discord socket that answers. */
export async function openDiscordSocket(paths = ipcPaths(), connector: Connector = (p) => connect(p)): Promise<Socket> {
  for (const path of paths) {
    const socket = await new Promise<Socket | null>((resolve) => {
      const s = connector(path)
      const fail = (): void => {
        s.destroy()
        resolve(null)
      }
      s.once('connect', () => {
        s.off('error', fail)
        resolve(s)
      })
      s.once('error', fail)
    })
    if (socket) return socket
  }
  throw new Error('Discord is not running.')
}
