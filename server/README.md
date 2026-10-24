# Vanity account server

A small API for Vanity's accounts, friends, "now playing" presence and shared playtime stats. It stores everything in **Neon** (serverless Postgres).

The Vanity app never talks to the database directly. A database connection string inside an installed app could be extracted and used to read or change every account, so only this server holds it.

```
Vanity app  ──HTTPS──▶  this API (Vercel, or any Node host)  ──▶  Neon Postgres
```

## 1. Create the Neon database

1. Sign up at [console.neon.tech](https://console.neon.tech) and create a project. Pick the region closest to you; the default Postgres version is fine.
2. On the project dashboard, click **Connect**. Choose **Pooled connection** and copy the connection string. It looks like:
   `postgresql://neondb_owner:…@ep-something-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require`
3. Create the tables, in either of two ways:
   - **From this folder:**
     ```bash
     cd server
     npm install
     cp .env.example .env      # then paste DATABASE_URL into .env
     npm run migrate
     ```
   - **In Neon:** open **SQL Editor**, paste the contents of [`schema.sql`](schema.sql) and run it.

   `schema.sql` is safe to run again later. It only creates what's missing.

## 2. Configure

`server/.env` (never commit it; it's git-ignored):

```
DATABASE_URL=<your pooled Neon connection string>
JWT_SECRET=<long random string>
PORT=8787
```

Generate a `JWT_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Changing `JWT_SECRET` later signs everyone out.

## 3. Run it

**Locally**, for trying it out on your PC:

```bash
cd server
npm run dev          # http://localhost:8787
```

**Online**, so friends on other PCs can connect. With [Vercel](https://vercel.com) (free hobby tier):

```bash
npm i -g vercel
cd server
vercel                              # link a new project; accept the defaults
vercel env add DATABASE_URL         # paste the Neon string (Production)
vercel env add JWT_SECRET           # paste your secret (Production)
vercel --prod                       # prints https://<your-project>.vercel.app
```

Any Node 20+ host works too (Render, Fly.io, Railway, a VPS): run `npm start` with the two environment variables set.

## 4. Point Vanity at it

In Vanity, open **Account** (below Settings) → **Server**, and enter the URL: `http://localhost:8787` for local, or your `https://….vercel.app` URL. To build it in, add `MAIN_VITE_VANITY_API_URL=<url>` to the app's `.env.local`.

Everyone who wants to be friends must use the same server URL.

## API

All routes except `/auth/*` need `Authorization: Bearer <token>`.

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/auth/register` | `{ username, password }` → `{ token, user }`. Usernames are 3–20 letters, numbers or `_`, unique ignoring case; passwords at least 8 characters. |
| POST | `/auth/login` | `{ username, password }` → `{ token, user }` |
| GET | `/me` | The signed-in user |
| DELETE | `/me` | Deletes the account and all its data |
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

`gameKey` is `steam:<appid>` for Steam games and `name:<normalised title>` for everything else, so the same game matches across friends' libraries.

**Security notes:**
- **Passwords:** hashed with scrypt.
- **Sessions:** HMAC-signed tokens that last 30 days.
- **Rate limits:** sign-in and registration are limited per IP, per server instance.
- **Database access:** every query is parameterised.

There is no email or password reset. To add one later, add an `email` column and a reset flow.

## Tests

```bash
npm test
```

The tests run the real `schema.sql` and every route against an in-process Postgres (PGlite), so no Neon connection is needed.
