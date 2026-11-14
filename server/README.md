# Vanity backend (on Neon)

Everything online in Vanity runs on **Neon**:

```
Vanity app ──▶ Neon Auth          sign-up, sign-in, sessions, password-reset emails
     │
     └───────▶ Vanity server      a Neon Function: usernames, friends, "now playing", shared stats
                    │
                    └──▶ Neon Postgres   the database (only the server can reach it)
```

- **No password code here.** Passwords go from the app straight to Neon Auth (a hosted [Better Auth](https://better-auth.com) server). This server only ever sees short-lived tokens that Neon Auth signs, and checks them against Neon Auth's public keys.
- **No secrets in the app or this repository.** The app knows two public addresses (`src/shared/backend.ts`). The database password stays inside Neon. Later stages add a Steam Web API key: it will live here as a Neon Function secret, never in the app.

## Set it up (once)

You need a free [Neon](https://console.neon.tech) account and this GitHub repository. No tools to install.

1. **Create a Neon project** (or reuse the one you have). Pick an **AWS** region from this list, because Neon Functions only run there for now: `US East (Ohio)`, `US East (N. Virginia)`, `Europe (Frankfurt)`, `Asia Pacific (Singapore)`.
2. **Copy the project ID:** Neon console → your project → **Settings** → *Project ID* (it looks like `cool-lab-12345678`).
3. **Create an API key:** Neon console → click your avatar → **Account settings** → **API keys** → *Create new API key*. Copy it now: it is shown once.
4. **Give both to GitHub:** this repository → **Settings** → **Secrets and variables** → **Actions** → *New repository secret*. Add two secrets:
   - `NEON_PROJECT_ID`: the project ID from step 2
   - `NEON_API_KEY`: the key from step 3
5. **Deploy:** this repository → **Actions** → **Deploy backend** → **Run workflow**.

The workflow turns on Neon Auth, deploys the server, signs up a throwaway account to check everything works (and removes it again), and saves the two public addresses into `src/shared/backend.ts`. The next Vanity release has accounts switched on. It runs again by itself whenever `server/` changes.

### Things to know

- **Emails** (password-reset codes) are sent by Neon's shared mail service from `auth@mail.myneon.app`, which is meant for getting started. They can land in spam. For a wider release, set your own SMTP provider in the Neon console → **Auth** → *Email*.
- **Email confirmation at sign-up** is off by default in Neon Auth, and Vanity expects that: a new account is signed in straight away. If you turn it on in the Neon console, new users must confirm their address before they can sign in.
- **Trusted origins.** Neon Auth only answers requests from origins it trusts, and local addresses are trusted by default. The app sends `http://localhost:5173` (`BACKEND.origin` in `src/shared/backend.ts`). If you ever switch *Allow localhost* off in the Neon console (Auth → Domains), sign-in stops working until you add that origin as a trusted domain.
- **The old server.** Vanity used to keep accounts itself (usernames and password hashes in `public.users`, with its own tokens). That is gone. The old tables in the `public` schema are not used or touched: everything now lives in the `vanity` schema, and you can drop the old tables whenever you like.

## How sign-in works

1. The app posts the email and password to Neon Auth (`/sign-in/email`). Neon Auth answers with a session cookie.
2. The app keeps that cookie in the operating system's protected storage: DPAPI on Windows (`session.bin`, readable only by that Windows user on that PC) and a Keystore-encrypted value on Android. With "Stay signed in" off it is kept in memory only.
3. To talk to this server, the app trades the cookie for a 15-minute token (a JWT signed with Ed25519) and sends it as `Authorization: Bearer …`. When the token runs out it gets a new one by itself.
4. If Neon Auth says the session is over (expired, or signed out), the app forgets it and asks you to sign in again.
5. **Forgot password:** Neon Auth emails a 6-digit code; the app sends the code and the new password back to Neon Auth.

## API

Send `Authorization: Bearer <Neon Auth token>` on everything except the first two rows. Every route also works under `/api`.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/` | `{ name: "vanity-api", ok: true }` |
| GET | `/usernames/:name` | `{ available }`: whether a username is free (rate-limited per IP) |
| GET | `/me` | `{ user: { id, email, username } }`; `username` is null until one is picked |
| PUT | `/me/username` | `{ username }`: picks or changes it. 3–20 letters, numbers or `_`, unique ignoring case |
| DELETE | `/me` | Removes the Vanity profile, friends, presence and stats |
| PUT | `/presence` | Heartbeat: `{ gameKey, gameName, startedAt }`, or `{ gameKey: null }` when not playing |
| DELETE | `/presence` | Signed out / closed: shows as offline |
| PUT | `/stats` | `{ games: [{ gameKey, gameName, playtimeSeconds, lastPlayedAt }] }` (up to 5000) |
| GET | `/friends` | Friends with status (playing / online / offline) and totals, plus incoming and outgoing requests |
| POST | `/friends/requests` | `{ username }`: sends a request, or accepts one they already sent you |
| POST | `/friends/requests/:id/accept` | Accept a request from user `:id` |
| DELETE | `/friends/requests/:id` | Decline or cancel a pending request |
| DELETE | `/friends/:id` | Remove a friend |
| GET | `/friends/:id/stats` | A friend's playtime totals, top games and recent games (friends only) |
| GET | `/games/:gameKey/friends` | Friends who've played a game |

Routes after `/me` answer `409` with `code: "needs_username"` until the account has a username.

`gameKey` is `g:<normalised-title>` (e.g. `g:the-witcher-3-wild-hunt`, ignoring punctuation, ™ and edition words), so the same game matches across friends' libraries whichever store they own it on.

**Security notes**
- **Tokens:** verified against Neon Auth's published keys (`NEON_AUTH_JWKS_URL`, injected by Neon), EdDSA only, with the expiry enforced.
- **Database:** every query is parameterised, and the tables hold no passwords or emails (`src/schema.ts`). The server creates its tables by itself on first use.
- **Deleting an account** removes what Vanity stores. The sign-in record at Neon Auth stays until you remove it in the Neon console (Auth → Users).

## Working on it

```bash
cd server
npm install
npm test             # every route on an in-process Postgres (PGlite), plus the app's account code
                     # signing in at a local stand-in for Neon Auth, end to end
npm run typecheck
```

- **Try the app's account screens without Neon:** `npx tsx test/support/local-stack.ts` starts a stand-in for Neon Auth and this server on one local port (reset codes are printed in that terminal). Then, in the repo root:
  `MAIN_VITE_NEON_AUTH_URL=http://127.0.0.1:8791/neondb/auth MAIN_VITE_VANITY_BACKEND_URL=http://127.0.0.1:8791/api npm run dev`
- **Deploy by hand** instead of the workflow: `NEON_API_KEY=… npx neon deploy --project-id <id>`, then `node scripts/smoke.mjs` with `NEON_AUTH_URL` and `VANITY_API_URL` set.
- **Files:** `neon.ts` (what Neon should run), `src/function.ts` (Neon Function entry), `src/app.ts` (routes), `src/auth.ts` (token check), `src/schema.ts` (tables).

## App updates (run-from-source copies only)

Unrelated to accounts: `src/index.ts` is a second entry for hosting this same app on Vercel, where `npm run build` packs the Vanity source into an update bundle served at `/update` and `/update/download` (optionally protected by `UPDATE_KEY`). Only copies of Vanity that are run from source use it (`MAIN_VITE_VANITY_API_URL`). Installed copies update from GitHub Releases and don't need it.
