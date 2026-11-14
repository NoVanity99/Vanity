// Vercel (Hono framework) entry: the default export is the app.
// It's built on the first request, so the environment is only read at runtime, never during the build.
import { Hono } from 'hono'
import { appFromEnv } from './config'

let inner: ReturnType<typeof appFromEnv> | null = null

const app = new Hono()
app.all('*', (c) => (inner ??= appFromEnv(process.env, {
    // Built into the deployment by `npm run build`; loaded only when someone asks for an update.
    updates: () => import('./generated/update-bundle').then((m) => m.updateBundle),
    updateKey: process.env.UPDATE_KEY?.trim() || undefined
  })).fetch(c.req.raw))

export default app
