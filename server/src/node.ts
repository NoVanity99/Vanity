// Local / any-Node-host entry: `npm run dev` (watches) or `npm start`.
import { serve } from '@hono/node-server'
import { appFromEnv } from './config'

process.loadEnvFile?.('.env')

const app = appFromEnv()
const port = Number(process.env.PORT) || 8787
serve({ fetch: app.fetch, port }, () => console.log(`Vanity API listening on http://localhost:${port}`))
