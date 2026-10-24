// Vercel (Hono framework) entry: the default export is the app.
// It's built on the first request, so DATABASE_URL and JWT_SECRET are only read at runtime, never during the build.
import { Hono } from 'hono'
import { appFromEnv } from './config'

let inner: ReturnType<typeof appFromEnv> | null = null

const app = new Hono()
app.all('*', (c) => (inner ??= appFromEnv()).fetch(c.req.raw))

export default app
