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

### Steam linking: where the Steam key goes

Steam linking needs a Steam Web API key. It lives **only** on the server, as a secret of the Neon Function. It is never in the app, in any file that ships, or in this repository.

1. Get a key at <https://steamcommunity.com/dev/apikey> (sign in with a Steam account that has made a purchase; for "Domain name" enter anything, such as `vanity`).
2. In this repository: **Settings** → **Secrets and variables** → **Actions** → *New repository secret*. Name: `STEAM_WEB_API_KEY`. Secret: the key.
3. **Actions** → **Deploy backend** → **Run workflow**. The deploy stores the key on Neon and checks it by looking up a public Steam profile.

To change the key later, update the secret and run the workflow again. A deploy without the secret leaves the key on Neon as it is. To remove it, delete it in the Neon console (the function's environment variables).

The key allows 100,000 calls a day for everyone together, so the server protects it: answers are cached for 5–10 minutes (custom URL names for a day), each account may make 30 Steam requests a minute, and each account has a budget of 1,500 calls to Steam per day. Achievement totals are worked out a batch of games at a time and remembered, re-checking recently played games hourly and the rest weekly.

### Vanity Coins: setting up Stripe

Players buy Vanity Coins on Stripe's own payment page. The server starts that payment and is told by Stripe, in a signed message (a "webhook"), when it has gone through; only then are coins added. Two secrets are needed, and both live **only** on the server, like the Steam key. Until they are set, the store in the app says buying isn't switched on (everything else about coins works, including coins an admin gives).

Use a **sandbox** first: a Stripe test environment where nothing is charged. In the dashboard, open the account menu (top left) → *Sandboxes* → create one for Vanity, and do the steps below inside it. (The older shared "Test mode" switch works too.)

1. Create an account at <https://dashboard.stripe.com> and make sure the **Test mode** switch (top right) is on.
2. **API key:** Developers → **API keys** → *Create restricted key*. Give it **Write** on *Checkout Sessions* and on *Customer portal* (for Vanity Plus's Manage button) and nothing else, and copy it (it starts with `rk_test_`). A restricted key is what Stripe recommends: if it ever leaked it could only start checkouts, not move money or read customers. (The full *Secret key*, `sk_test_…`, also works.)
3. **Webhook:** Developers → **Webhooks** → *Add endpoint*.
   - Endpoint URL: the Vanity server's address followed by `/stripe/webhook`, for example `https://br-damp-pine-bdkamz55-vanity.compute.c-8.us-east-2.aws.neon.tech/stripe/webhook` (the address is `apiUrl` in `src/shared/backend.ts`).
   - Events to send: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, and for Vanity Plus `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
   - After saving, open the endpoint and reveal its **Signing secret**. It starts with `whsec_`.
4. In this repository: **Settings** → **Secrets and variables** → **Actions** → add `STRIPE_SECRET_KEY` (the key from step 2) and `STRIPE_WEBHOOK_SECRET` (from step 3). Never put either in a file, in the app, or in a chat.
5. **Actions** → **Deploy backend** → **Run workflow**.

**Try a purchase:** in Vanity, click your coin balance → pick a bundle → on Stripe's page pay with the test card `4242 4242 4242 4242`, any future expiry date, any 3-digit CVC and any postcode. Within a few seconds the balance in Vanity goes up by itself, and Account → Purchase history shows it. To try a refund, open the payment in the Stripe dashboard and click *Refund*: the coins come off again. `4000 0000 0000 0259` is a test card whose payment gets disputed (a chargeback).

**Vanity Plus (the monthly membership)** uses the same two secrets. Its price is `VANITY_PLUS` in `server/src/coinBundles.ts`. One extra step, once per Stripe environment: Settings → Billing → **Customer portal** → switch on *Cancel subscriptions* and *Update payment methods*, and Save. That is the page the Manage button opens. To try it: Get Coins → **Get Plus** → pay with `4242 4242 4242 4242`; Vanity shows "Member" within a few seconds and every premium look loses its price tag. Cancel from **Manage**: it says "Cancelled. You keep Plus until …". The server keeps a membership's state in `vanity.plus_members`, from Stripe's `customer.subscription.*` messages only (an older message arriving late never undoes a newer one).

**Going live:** switch the dashboard out of test mode, make a live secret key (`sk_live_`) and a live webhook endpoint with the same URL and events, replace the two GitHub secrets, and deploy again. Stripe will ask for your business and bank details first. Publish a short terms and refund policy before selling to real players.

**Prices and bundles** are in `server/src/coinBundles.ts`: edit, push, and the store shows them (no app update). What coins buy, and for how much, is in the same file.

How the money side is kept safe:

- The app only names a bundle. The price and the number of coins come from the server's own list.
- Coins are added only for a `checkout.session.completed` message whose signature matches the webhook secret, for a checkout this server started, and for the amount it asked.
- Every change is a row in `vanity.coin_ledger` (purchase, spend, refund, chargeback, reversal, admin) that is never edited. `(kind, ref)` is unique, so a repeated Stripe message or a double click can't count twice. The balance is the running total of those rows.
- A refund takes the same share of the coins back; a chargeback takes back what is left of that purchase (a balance can go below zero if the coins were already spent); a dispute won gives them back.

### Admins

`server/src/roles.ts` is only the starting list: each name on it is turned into a badge on the account that holds the name, once, and from then on the badge belongs to that account whatever it is renamed to. After that, badges are given and taken in the app (Settings → Admin), and removing a name from the file changes nothing. Everything an admin does is checked on the server and written to `vanity.admin_log`.

### Things to know

- **Emails** (password-reset codes) are sent by Neon's shared mail service from `auth@mail.myneon.app`, which is meant for getting started. They can land in spam. For a wider release, set your own SMTP provider in the Neon console → **Auth** → *Email*. [Resend](https://resend.com) works there (it offers SMTP): it needs a Resend account and a domain you own, verified in Resend. Its key is typed into the Neon console only: it never goes in the app, this repository or a `.env` file.
- **Passwords** are hashed by Neon Auth (Better Auth: scrypt with a per-password salt) and stored in the `neon_auth` schema of the same database, with the sessions and reset codes. Neon Auth also rate-limits sign-in, sign-up and reset requests itself; this server adds its own limits to the public checks and to signing in with a username.
- **Email confirmation at sign-up** is off by default in Neon Auth, and Vanity expects that: a new account is signed in straight away. If you turn it on in the Neon console, new users must confirm their address before they can sign in.
- **Trusted origins.** Neon Auth only answers requests from origins it trusts, and local addresses are trusted by default. The app sends `http://localhost:5173` (`BACKEND.origin` in `src/shared/backend.ts`). If you ever switch *Allow localhost* off in the Neon console (Auth → Domains), sign-in stops working until you add that origin as a trusted domain.
- **The old server.** Vanity used to keep accounts itself (usernames and password hashes in `public.users`, with its own tokens). That is gone. The old tables in the `public` schema are not used or touched: everything now lives in the `vanity` schema, and you can drop the old tables whenever you like.

## How sign-in works

1. The app posts the email and password to Neon Auth (`/sign-in/email`). Neon Auth answers with a session cookie. If a **username** was typed instead, the app posts it to this server (`POST /auth/sign-in`), which looks the email up privately, asks Neon Auth, and hands the same session back: a username is never turned into its email for a stranger. Every failure reads "Incorrect username/email or password."
2. The app keeps that cookie in the operating system's protected storage: DPAPI on Windows (`session.bin`, readable only by that Windows user on that PC) and a Keystore-encrypted value on Android. With "Stay signed in" off it is kept in memory only.
3. To talk to this server, the app trades the cookie for a 15-minute token (a JWT signed with Ed25519) and sends it as `Authorization: Bearer …`. When the token runs out it gets a new one by itself.
4. If Neon Auth says the session is over (expired, or signed out), the app forgets it and asks you to sign in again.
5. **Forgot password:** Neon Auth emails a 6-digit code (the app says the same thing whether or not the address has an account); the app sends the code and the new password back to Neon Auth, signs in, and ends every other session of the account (`/revoke-other-sessions`).

## API

Send `Authorization: Bearer <Neon Auth token>` on everything except the first two rows. Every route also works under `/api`.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/` | `{ name: "vanity-api", ok: true }` |
| GET | `/usernames/:name` | `{ available }`: whether a username is free (rate-limited per IP) |
| POST | `/auth/sign-in` | `{ username, password }` → `{ user, setCookie, jwt }`: signs in at Neon Auth for someone who typed their username. Public; rate-limited per IP and per username (10 wrong passwords per 10 minutes). `401` with one fixed message for every failure. The password is passed on over https and never stored or logged |
| GET | `/me` | `{ user: { id, email, username } }`; `username` is null until one is picked |
| POST | `/emails/check` | `{ email }` → `{ inUse }`: whether an email already has an account (true/false), or `null` when Neon Auth's own tables can't be read from the server. Public and rate-limited; the sign-up form uses it. Neon Auth itself refuses a second account for an email either way |
| PUT | `/me/username` | `{ username }`: picks or changes it. 3–20 letters, numbers or `_`, unique ignoring case, no blocked or reserved words. A change is allowed once every 30 days and kept in `vanity.username_history` |
| GET | `/pulse` | The quick check-in every few seconds: this account's coins, name, badges, ban or time-out, and calls ringing for it |
| GET | `/coins` | The store: balance, bundles, what coins buy, what is owned |
| POST | `/coins/checkout` | `{ bundleId }` → `{ url }`: starts a Stripe Checkout |
| POST | `/coins/buy` | `{ itemId }`: spends coins |
| GET | `/coins/history` | The account's ledger, newest first |
| POST | `/stripe/webhook` | Messages from Stripe (no token: the signature is the proof) |
| GET, POST | `/games/:key/comments` | A game's comments (newest first, `?before=`), and posting one |
| PATCH, DELETE | `/comments/:id` | Edit or delete your own comment (admins can delete any) |
| POST | `/comments/:id/report` | Report a comment to the admins |
| POST | `/voice/call` | `{ friendId }` or `{ groupId }`: starts that chat's call and rings the others, or joins it |
| POST | `/voice/rings/:roomId/decline` | Stops a call ringing for you |
| * | `/admin/…` | The admin tools (admin badge required) |
| PUT | `/me/profile` | `{ avatar?, bio?, style? }`: the profile picture (a small PNG/JPEG/WebP as a `data:` address, about 40 KB at most; `null` removes it) a bio of up to 200 characters, and the profile's look: `style` is `{ banner?, frame?, nameStyle?, flair? }`, each an id from the fixed lists in `src/profileStyle.ts` (anything else is refused). Fields left out stay as they are |
| DELETE | `/me` | Removes the Vanity profile, friends, presence and stats |
| POST | `/sync` | Cloud-saved progress: the device sends what it knows (per-device counters, choices with timestamps, days, badges, collections, settings) and gets the merged result back. Rules are in `src/sync.ts`. Rate-limited per account |
| GET | `/steam/link` | `{ configured, link }`: the linked Steam account (`steamId`, `name`, `avatar`, `profileUrl`, `verified`), and whether the server has a Steam key |
| PUT | `/steam/link` | `{ input }`: links from a SteamID64, a profile link or a custom URL name |
| DELETE | `/steam/link` | Unlinks |
| POST | `/steam/resolve` | `{ input }` → `{ profile }`: looks an account up without linking it (uses ResolveVanityURL for names) |
| GET | `/steam/owned-games` | The linked account's games with playtime and icons. `409` with `code: "steam_private"` when game details are private |
| GET | `/steam/recent-games` | Games played in the last two weeks |
| GET | `/steam/achievements/:appId` | The linked account's achievements for one game |
| GET | `/steam/achievements-summary` | Total achievements unlocked; ask again while `complete` is false |
| POST | `/steam/openid/start` | `{ url }`: Steam's sign-in page, to open in a browser |
| GET | `/steam/openid/return` | Where Steam sends the browser back (no token: the one-time `state` identifies who started it). Checks the answer with Steam, links the account, shows a small page |
| PUT | `/presence` | Heartbeat: `{ gameKey, gameName, startedAt }`, or `{ gameKey: null }` when not playing. Answers with the account's `{ verified, admin }` |
| DELETE | `/presence` | Signed out / closed: shows as offline |
| PUT | `/stats` | `{ games: [{ gameKey, gameName, playtimeSeconds, lastPlayedAt }] }` (up to 5000) |
| GET | `/friends` | Friends with status (playing / online / offline), totals, unread message count and the latest message of each chat, plus incoming and outgoing requests |
| POST | `/friends/requests` | `{ username }`: sends a request, or accepts one they already sent you |
| POST | `/friends/requests/:id/accept` | Accept a request from user `:id` |
| DELETE | `/friends/requests/:id` | Decline or cancel a pending request |
| DELETE | `/friends/:id` | Remove a friend |
| GET | `/friends/:id/stats` | A friend's profile in detail: totals, top games (with launches, their rating and status), recent, favourites, what they're playing, streaks, days played, when they joined and when you became friends, friends in common, linked Steam account, and how many messages you've exchanged (friends only; their notes are never included) |
| GET | `/friends/:id/messages` | A page of your chat with a friend, oldest first. `?before=<id>` pages back, `?after=<id>` returns only newer ones, `?limit=` up to 100. Reading marks their messages as read; `seenUpTo` is the newest of yours they have read |
| POST | `/friends/:id/messages` | `{ text }` (up to 2,000 characters): sends a message. Friends only; 40 a minute per account. Messages are never deleted |
| GET | `/games/:gameKey/friends` | Friends who've played a game |

Routes after `/me` answer `409` with `code: "needs_username"` until the account has a username.

`gameKey` is `g:<normalised-title>` (e.g. `g:the-witcher-3-wild-hunt`, ignoring punctuation, ™ and edition words), so the same game matches across friends' libraries whichever store they own it on.

**Security notes**
- **Tokens:** verified against Neon Auth's published keys (`NEON_AUTH_JWKS_URL`, injected by Neon), EdDSA only, with the expiry enforced.
- **Database:** every query is parameterised, and the tables hold no passwords or emails (`src/schema.ts`).
- **The Steam key** is read from the function's environment and added to requests on the server. Error messages and logs never include it. Steam routes answer `503` with `code: "steam_not_configured"` until the key is set.
- **Sync can't take progress away:** a device can never lower a counter or remove a day or badge, and a clock set in the future can't make its changes win forever (timestamps are capped at the server's time). The server creates its tables by itself on first use.
- **Deleting an account** removes what Vanity stores. The sign-in record at Neon Auth stays until you remove it in the Neon console (Auth → Users).

## Official badges (verified and admin)

`/me`, the friends list, friend requests and friend stats all carry `verified` and `admin` for each account. They come from one place only: the two lists in [`src/roles.ts`](src/roles.ts), matched against the username without regard to capitals. Nothing the app sends can set them.

To give someone a badge, add their Vanity username to the list in `src/roles.ts` and push: the "Deploy backend" workflow puts it live. Nobody has to update the app: `PUT /presence`, which every running app calls about once a minute, answers with that account's `{ verified, admin }`, so the badge shows within a minute or so for the person, and for their friends when their list next refreshes. Because badges follow the username, the account must keep that name: if it is ever renamed or deleted, the name becomes free and whoever takes it would get the badge, so remove it from the list first.

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
