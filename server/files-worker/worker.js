// Vanity's file store: a small Cloudflare Worker in front of an R2 bucket. It keeps the pictures
// and files people send in Channels.
//
// Only the Vanity server talks to it. Every address starts with a long secret (the KEY setting);
// anything else gets "not found". The Vanity server decides who may upload and who may read; this
// Worker only stores and returns bytes.
//
// A file is kept as numbered parts (the server sends it a part at a time):
//   PUT    /<key>/o/<id>/<n>          store part n
//   GET    /<key>/o/<id>?parts=N      the whole file, parts 0..N-1 in order
//   DELETE /<key>/o/<id>?parts=N      remove it
//
// Deployed with server/scripts/deploy-files-worker.mjs.

const ID = /^[A-Za-z0-9_-]{8,40}$/
const MAX_PART = 2 * 1024 * 1024
const MAX_PARTS = 64

const same = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
const no = () => new Response('Not found', { status: 404 })

export async function handle(request, env) {
  const url = new URL(request.url)
  const [, key, kind, id, part] = url.pathname.split('/')
  if (!env.KEY || env.KEY.length < 32 || !same(key, env.KEY) || kind !== 'o' || !ID.test(id ?? '')) return no()
  const parts = Number(url.searchParams.get('parts'))

  if (request.method === 'PUT') {
    const n = Number(part)
    if (!/^\d{1,2}$/.test(part ?? '') || n >= MAX_PARTS) return no()
    const bytes = await request.arrayBuffer()
    if (!bytes.byteLength || bytes.byteLength > MAX_PART) return new Response('Too big', { status: 413 })
    await env.BUCKET.put(`${id}/${n}`, bytes)
    return new Response(null, { status: 204 })
  }
  if (part !== undefined || !Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS) return no()

  if (request.method === 'GET') {
    const first = await env.BUCKET.get(`${id}/0`)
    if (!first) return no()
    let n = 0
    let reader = first.body.getReader()
    const body = new ReadableStream({
      async pull(controller) {
        for (;;) {
          const { done, value } = await reader.read()
          if (!done) return controller.enqueue(value)
          if (++n >= parts) return controller.close()
          const next = await env.BUCKET.get(`${id}/${n}`)
          if (!next) return controller.error(new Error('A part is missing'))
          reader = next.body.getReader()
        }
      },
      cancel() {
        return reader.cancel()
      }
    })
    return new Response(body, { headers: { 'content-type': 'application/octet-stream' } })
  }
  if (request.method === 'DELETE') {
    await env.BUCKET.delete(Array.from({ length: parts }, (_, i) => `${id}/${i}`))
    return new Response(null, { status: 204 })
  }
  return no()
}

export default { fetch: handle }
