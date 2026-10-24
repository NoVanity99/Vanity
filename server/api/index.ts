// Vercel entry: every route is rewritten here (see vercel.json).
import { handle } from 'hono/vercel'
import { appFromEnv } from '../src/config'

export const config = { runtime: 'nodejs' }

const handler = handle(appFromEnv())
export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
