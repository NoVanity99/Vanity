import type { Result, VanityApi } from '@shared/ipc'
import { MAX_GIF_BYTES, MAX_GROUP_SIZE } from '@shared/groups'
import type { AccountClient } from './client'
import { AccountError } from './errors'

/** What the chat calls need from the account: run a call on the signed-in client. */
interface Guard {
  guard<T>(fn: (c: AccountClient) => Promise<T>): Promise<T>
}

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { data: await fn() }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined)

/**
 * Group chats and GIFs, the same on Windows (through IPC) and on phones (directly). Uploaded GIFs
 * are fetched once and kept in memory as data: addresses, so they show at once next time.
 */
export function chatApi(account: Guard): Pick<VanityApi, 'groups' | 'gifs'> {
  const media = new Map<string, string>()
  let mediaBytes = 0
  return {
    groups: {
      list: () => wrap(() => account.guard((c) => c.groups())),
      create: (name, memberIds) => wrap(() => account.guard((c) => c.createGroup(str(name, 80), (Array.isArray(memberIds) ? memberIds : []).slice(0, MAX_GROUP_SIZE).map((x) => str(x))))),
      rename: (id, name) => wrap(() => account.guard((c) => c.renameGroup(str(id), str(name, 80)))),
      add: (id, userId) => wrap(() => account.guard((c) => c.addToGroup(str(id), str(userId)))),
      remove: (id, userId) => wrap(async () => (await account.guard((c) => c.removeFromGroup(str(id), str(userId))), true as const)),
      messages: (id, opts) => wrap(() => account.guard((c) => c.groupMessages(str(id), { before: num(opts?.before), after: num(opts?.after) }))),
      send: (id, text) => wrap(() => account.guard((c) => c.sendGroupMessage(str(id), str(text, 4000))))
    },
    gifs: {
      search: async (query, page) => {
        try {
          return { data: await account.guard((c) => c.searchGifs(str(query, 80), Math.max(1, Math.min(20, num(page) ?? 1)))) }
        } catch (err) {
          // No GIF search on this server: the picker shows only "From your device".
          if (err instanceof AccountError && err.code === 'gifs_off') return { error: err.message, off: true }
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
      upload: (base64) =>
        wrap(async () => {
          const data = str(base64, Math.ceil((MAX_GIF_BYTES * 4) / 3) + 8)
          if (!data) throw new Error("That file couldn't be read.")
          return account.guard((c) => c.uploadGif(data))
        }),
      media: (id) =>
        wrap(async () => {
          const key = str(id, 60)
          const known = media.get(key)
          if (known) return known
          const r = await account.guard((c) => c.media(key))
          const url = `data:${r.mime === 'image/gif' ? 'image/gif' : 'application/octet-stream'};base64,${r.data}`
          // Keep the newest ~60 MB.
          media.set(key, url)
          mediaBytes += url.length
          for (const [k, v] of media) {
            if (mediaBytes < 60_000_000) break
            media.delete(k)
            mediaBytes -= v.length
          }
          return url
        })
    }
  }
}
