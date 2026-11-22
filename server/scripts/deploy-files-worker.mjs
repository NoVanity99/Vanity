// Sets up where Channels keep pictures and files: an R2 bucket and the small Worker in front of
// it (server/files-worker/worker.js), in your Cloudflare account.
//
//   CLOUDFLARE_API_TOKEN=... node scripts/deploy-files-worker.mjs <file to write the address to>
//
// The token needs "Workers Scripts: Edit" and "Workers R2 Storage: Edit". The script prints
// nothing secret: the finished address (which contains a long random key) is written to the
// file you name. Put that one line in the GitHub secret FILES_URL and run "Deploy backend".
// Running it again makes a new key (the old address stops working until the secret is updated).
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const token = process.env.CLOUDFLARE_API_TOKEN
const out = process.argv[2]
if (!token || !out) {
  console.error('Usage: CLOUDFLARE_API_TOKEN=... node scripts/deploy-files-worker.mjs <file to write the address to>')
  process.exit(1)
}
const NAME = 'vanity-files'
const api = async (path, init = {}) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  const json = await res.json().catch(() => ({}))
  if (!json.success) throw new Error(`${init.method ?? 'GET'} ${path.replace(/[0-9a-f]{32}/g, '<account>')}: ${JSON.stringify(json.errors ?? res.status)}`)
  return json.result
}

const [account] = await api('/accounts')
if (!account) throw new Error('This token has no Cloudflare account.')
const base = `/accounts/${account.id}`

const buckets = (await api(`${base}/r2/buckets`)).buckets ?? []
if (buckets.some((b) => b.name === NAME)) console.log(`ok    the "${NAME}" bucket is there`)
else {
  await api(`${base}/r2/buckets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: NAME }) })
  console.log(`ok    made the "${NAME}" bucket`)
}

const key = randomBytes(32).toString('hex')
const form = new FormData()
form.set(
  'metadata',
  JSON.stringify({
    main_module: 'worker.js',
    compatibility_date: '2024-11-01',
    bindings: [
      { type: 'r2_bucket', name: 'BUCKET', bucket_name: NAME },
      { type: 'secret_text', name: 'KEY', text: key }
    ]
  })
)
form.set('worker.js', new Blob([readFileSync(new URL('../files-worker/worker.js', import.meta.url))], { type: 'application/javascript+module' }), 'worker.js')
await api(`${base}/workers/scripts/${NAME}`, { method: 'PUT', body: form })
console.log(`ok    uploaded the "${NAME}" Worker`)
await api(`${base}/workers/scripts/${NAME}/subdomain`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, previews_enabled: false }) })
const { subdomain } = await api(`${base}/workers/subdomain`)
writeFileSync(out, `https://${NAME}.${subdomain}.workers.dev/${key}\n`, { mode: 0o600 })
console.log(`ok    it is live. Its address is in ${out}: put that line in the GitHub secret FILES_URL, then run "Deploy backend".`)
