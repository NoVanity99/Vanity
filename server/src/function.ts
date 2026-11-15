// Neon Functions entry (see neon.ts): the default export is the app.
// It is built on the first request, so the environment is only read at runtime.
import { Hono } from 'hono'
import { appFromEnv } from './config'

let inner: ReturnType<typeof appFromEnv> | null = null

const app = new Hono()
app.all('*', (c) => (inner ??= appFromEnv()).fetch(c.req.raw))

export default app
