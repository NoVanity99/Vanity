# Vanity voice server

The small server behind Vanity's voice rooms. It **introduces** players to each other: it keeps
the list of rooms and who is in them, checks everyone's Vanity sign-in, and passes WebRTC
connection details between them. **The audio itself does not go through it**: it goes directly
between players' apps (or through a TURN relay, below), encoded with Opus.

- Node 20+, one dependency (`ws`). `npm run build` makes a single file, `dist/voice-server.mjs`,
  that runs with plain `node`.
- Rooms live in memory: 6-character invite codes, up to 6 people each (a direct "mesh" works
  well up to about that). When everyone leaves, the room is gone. If the server restarts,
  people in a room reconnect by themselves and the room is made again under the same code.
- Separate from the main Vanity server (`server/`, a Neon Function), because voice needs a
  connection that stays open, which serverless functions don't keep.

## Run it on your PC

```bash
cd server/voice
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run dev               # or: npm run build && npm start
```

It prints `Vanity voice server on ws://localhost:8787`. Opening <http://localhost:8787> in a
browser shows `{"name":"vanity-voice","ok":true,...}`.

`.env` already points `VANITY_API_URL` at the Vanity account server, so it checks real Vanity
sign-ins. Nothing else is needed to start.

Then, in Vanity: **Settings → Voice → Voice server**, type `ws://localhost:8787`, and press **Save**.
It says "Found the voice server" when it can reach it.

To let **other PCs on your home network** join, use `ws://<this PC's local IP>:8787` on them
(for example `ws://192.168.1.20:8787`; `ipconfig` shows the IP). Windows asks once whether Node
may accept connections: allow it on private networks.

## Put it online (so friends anywhere can join)

Any host that keeps a Node program running and supports WebSockets works. You'll want an
`https://` address from the host, so the voice address is `wss://…` (encrypted).

Set these on the host (its "environment variables" page), not in a file in the repository:

| Variable | Value |
|---|---|
| `VANITY_API_URL` | `https://br-damp-pine-bdkamz55-vanity.compute.c-8.us-east-2.aws.neon.tech` (public, not a secret) |
| `TURN_URLS`, `TURN_SECRET` (or `TURN_USERNAME` + `TURN_CREDENTIAL`) | Your TURN server: see below |

The host sets `PORT` itself.

**Render** (simple, has a free tier):
1. New → Web Service → connect the GitHub repository.
2. Root directory: `server/voice`. Build command: `npm ci && npm run build`. Start command: `npm start`.
3. Add the environment variables above.
4. Free services go to sleep after about 15 minutes without visitors, and the first person to
   join then waits up to a minute. Pick a paid instance to avoid that.

**Fly.io** (always on, small cost): from the repository's top folder:
```bash
fly launch --dockerfile server/voice/Dockerfile --internal-port 8787 --no-deploy
fly secrets set VANITY_API_URL=https://br-damp-pine-bdkamz55-vanity.compute.c-8.us-east-2.aws.neon.tech
fly deploy
```

**Railway**, or **your own server with Docker**:
```bash
docker build -f server/voice/Dockerfile -t vanity-voice .    # from the repository's top folder
docker run -d --restart unless-stopped -p 8787:8787 --env-file server/voice/.env vanity-voice
```
Put it behind a reverse proxy with HTTPS (Caddy does this in two lines) so the address is `wss://`.

**Then tell Vanity where it is.** Either everyone types the address in **Settings → Voice → Voice server**,
or it's built into the app: set `voiceUrl` in `src/shared/backend.ts` (it's public, like the other
addresses there) and make a new release. Copies without an address show "Voice isn't set up yet".

## TURN: for strict networks

Most home connections can connect directly. Some can't: certain routers, mobile data (CGNAT),
offices, schools, some VPNs. Then two players join the same room but hear nothing, and their
tiles stay on "Connecting…". A **TURN server** fixes this by relaying their audio (about
40–60 kbit/s per person).

- **Hosted** (easiest): Metered.ca (has a free allowance), Twilio Network Traversal, or
  Cloudflare Realtime TURN. They give you addresses and either a shared secret or a username and
  password. Put them in `TURN_URLS` and `TURN_SECRET`, or `TURN_USERNAME` + `TURN_CREDENTIAL`.
- **Your own coturn** (on a small VPS), in `/etc/turnserver.conf`:
  ```
  listening-port=3478
  tls-listening-port=5349
  fingerprint
  use-auth-secret
  static-auth-secret=<a long random secret>
  realm=voice.example.com
  external-ip=<the server's public IP>
  min-port=49152
  max-port=65535
  ```
  Open UDP/TCP 3478, TCP 5349 and UDP 49152–65535 in the firewall. Then on the voice server:
  ```
  TURN_URLS=turn:voice.example.com:3478?transport=udp,turn:voice.example.com:3478?transport=tcp,turns:voice.example.com:5349?transport=tcp
  TURN_SECRET=<the same secret>
  ```

With `TURN_SECRET`, each player gets their own login that runs out after 6 hours
(`TURN_TTL_SECONDS`). The secret itself never leaves the voice server. The app never contains
TURN credentials.

## What it checks

- **Sign-in:** every player shows their Vanity sign-in token. The server asks the Vanity account
  server (`/me`) who it belongs to. Rooms show real names, pictures and badges, and nobody can
  join as someone else. Email addresses are never passed on.
- **Limits:** messages are size-checked (up to 256 KB) and rate-limited per connection. One voice
  connection per account (joining from another device disconnects the first). Silent
  connections are closed after about 50 seconds.
- `ALLOW_GUESTS=true` lets people in by a typed name, without an account. Only for trying the
  server on your own; keep it off online.

## Develop

```bash
npm test          # the server's tests (real WebSocket clients against a real server)
npm run typecheck
```

The messages are defined once, in `src/shared/voiceProtocol.ts`, shared with the app.

**Moving to a media server later** (LiveKit, mediasoup) for bigger rooms or screen sharing: the
app talks to the audio connections only through `VoiceTransport` (`src/renderer/src/voice/transport.ts`).
An SFU version of it would replace `MeshTransport` without touching the screens. This server
would then hand out the media server's access tokens instead of relaying offers and answers.
