# Vanity

A unified desktop game launcher for Windows 10/11. It finds your Steam, Epic, GOG, EA, Ubisoft and custom-folder games and shows them in one dark, cover-art library.

Built with Electron, React, TypeScript, Vite (via electron-vite), Tailwind CSS v4 and SQLite (better-sqlite3).

## Getting started

```bash
npm install        # no C++ build tools needed (see note below)
npm run dev        # start the app with hot reload
npm start          # build and run the app as it ships (updates rebuild and restart it)
npm test           # run the unit tests (scanners, parsers, filters)
npm run typecheck  # type-check main and renderer
npm run build      # type-check, then build to out/
npm run dist:win   # build a Windows installer into dist/
```

## Project layout

```
src/
  shared/            Types shared by every process (Game, Settings, IPC contract)
  main/              Electron main process (Node)
    index.ts         App lifecycle and window creation
    scanners/        One module per launcher source, all implementing Scanner (types.ts)
    library/         Scan orchestration and the game store
    util/            Registry reader, VDF parser, exe filtering, fs helpers
    settings.ts      Settings saved as JSON in the app's user-data folder
    db/              SQLite connection and schema migrations
    launcher/        Launching games and tracking playtime
    metadata/        SteamGridDB and IGDB clients, matching, local image cache
    ipc/             IPC handlers exposed to the renderer
  preload/           contextBridge that exposes window.vanity to the renderer
  renderer/          React UI
    src/pages/       Library (also Recently Played and Favorites), Game detail, Settings
    src/components/  Sidebar, game cards, context menu, dialogs, scan progress
    src/state/       Library and toast state shared across pages
    src/lib/         Formatting, preferences, placeholder art helpers
resources/           App icon and build resources
```

## Using the app

- **Sidebar:**
  - **Library**, **Trending** and **Steam Store** (the store embedded and locked down; your sign-in persists).
  - **Friends**, **Recently Played**, **Favorites** and **Stats** (your playtime, streak, longest session and per-day chart).
  - **Settings**, and **Account** below Settings.
- **Title bar:**
  - **Launcher status** on the left.
  - **Music player** on the right: click the artwork circle to choose a music folder, then press play to shuffle it. It shows the album art, the title and artist (from the file's tags, or its name), previous / play-pause / next and volume. Keyboard media keys work too. Artwork comes from the file, or from a `cover.jpg` / `folder.jpg` next to it.
  - **Update button:** the small round button beside the player.
- **Game pages:**
  - **Cover tint:** the page takes on the colour of the game's cover.
  - **Live stats:** players on Steam, or viewers on Twitch.
  - **Workshop:** a button for Steam games that have one.
  - **Your stats:** sessions, average and longest session, first played, last 7 and 30 days, days played, streaks, rank in your library and share of your playtime, a 30-day chart, and when you play (time of day and weekday).
  - **Milestones:** small awards from your own play (10 h, a 4-hour marathon, a 3-day streak, night owl…).
  - **Session history:** every recorded session with start and end times.
  - **Time to beat:** IGDB's community times for main story, extras and completionist, with your playtime against them.
  - **Ratings:** Metacritic, critics and players (IGDB), and Steam user reviews.
  - **Details:** publisher, series, price, achievements, DLC, modes, perspective, themes, platforms, languages, Steam features and system requirements.
  - **Media and news:** screenshots (click for a full-screen viewer), trailers (open on YouTube) and the latest Steam news.
  - **If you like this:** similar games, with the ones you own linked.
  - **Size on disk** of the install folder.
  - **Your journal:** a status (Backlog, Playing, Beaten, 100% completed, Dropped), a 1–5 star rating and private notes. Status shows on library cards, and the Library can filter by status and sort by your rating.
  - **Friends who played:** shown when you're signed in.
  - Online details come from IGDB (needs the keys) and Steam (no key), are cached for 12 hours, and **Refresh** at the bottom of the page fetches them again.
- **Surprise me** (Library): rolls a random game, favouring ones you haven't played in a while.

- **Library:** search (Ctrl+F), sort (name, recently played or added, most played, your rating, release date), filter by source, genre or status, and resize cards with the slider. Hover a cover for a quick Play button; right-click for every action. Your most recently played games sit in "Jump back in" at the top.
- **Settings:** rescan, launcher toggles, game folders, API keys with a key check, Refresh all metadata.
- **Themes:** Settings → Appearance has 15 colour skins, defined in `src/shared/themes.ts`. Add one there and it appears in Settings.
- **Fonts:** Settings → Appearance has 25 fonts in four groups (Clean, Friendly, Gaming, Stylish). Some pair a heading font with a body font, such as Poster (Bebas Neue + Montserrat) or Retro (Press Start 2P + Inter). They're all bundled from Fontsource, so they work offline.
  - To add one: `npm install @fontsource-variable/<name>`, import it in `src/renderer/src/main.tsx`, and add an entry in `src/shared/fonts.ts`. A test checks that every font listed there is bundled.
- **Launcher status:** the strip at the top of every page shows whether each store's services are reachable: green when online, red when not. They're checked every 5 minutes; click one to check again. Steam uses its Web API, Epic its public status page, and the others whether their store site answers (`src/main/status/checks.ts`).
- Vanity remembers its window size and position, and opening it again brings the existing window to the front. Animations follow Windows' "Animation effects" setting (reduced motion).

## API keys

Trending and game details need a Twitch client ID and secret (IGDB). Artwork uses a SteamGridDB key. There are two ways to provide them:

1. **In the app:** on the Trending tab, click **Enter keys**. They're saved encrypted in Vanity's settings.
2. **Built in:** run `npm run setup-keys` in the project folder and answer the prompts. It writes `.env.local` for you, and renames `.env.local.txt` if Notepad created that. Then restart `npm run dev`.

`npm run dev` prints a warning if `.env.local` is missing or misnamed.

### Built-in keys (.env.local)

Or create `.env.local` by hand (copy `.env.example`) in the project folder, next to `package.json`:

```
MAIN_VITE_STEAMGRIDDB_API_KEY=...
MAIN_VITE_IGDB_CLIENT_ID=...
MAIN_VITE_IGDB_CLIENT_SECRET=...
```

`.env.local` is ignored by git, so the keys never reach GitHub. They are built into the main process when you run `npm run dev` or `npm run build` (restart `npm run dev` after editing the file), and are used whenever the matching Settings field is empty. A key typed into Settings takes priority. Since they end up inside the built app, don't share builds or installers made with your keys.

## Game sources

| Source | How games are found | ID |
| --- | --- | --- |
| Steam | `libraryfolders.vdf` for every library, then each `appmanifest_*.acf` | App ID |
| Epic Games | `.item` manifests in `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests` | App name |
| GOG Galaxy | `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games` | GOG game ID |
| EA app | Windows uninstall entries from EA, plus EA's own registry keys; exe from `__Installer\installerdata.xml` | Install folder |
| Ubisoft Connect | `HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs` | Ubisoft ID |
| Custom folders | `.exe` files, minus uninstallers, crash reporters, redistributables and launchers; you confirm each one | Exe path |

Registry keys are read with one PowerShell call per lookup, which keeps non-ASCII names intact. A source whose launcher is missing is shown as skipped; one that fails is shown as failed. Neither stops the rest of the scan.

To add a source, write a module in `src/main/scanners/` that exports a `Scanner` and add it to `src/main/scanners/index.ts`.

## Launching and playtime

| Source | How Play starts it |
| --- | --- |
| Steam | `steam://rungameid/<appid>` |
| Epic Games | `com.epicgames.launcher://apps/<appname>?action=launch&silent=true` |
| Everything else | The game's exe, run with its own folder as the working directory. If Windows says it needs admin rights, it is started through the shell so the UAC prompt appears. |

The exe for GOG, EA, Ubisoft, custom and manual games can be changed in **Edit metadata** or on the game page; your choice is kept across rescans.

Playtime is tracked by checking running processes every few seconds (via PowerShell's `Get-Process`). A game counts as running while the exe Vanity started is alive, or while any process runs from inside its install folder. That covers Steam and Epic games, which Vanity doesn't start itself, and launcher stubs that start the real game and exit. Time counts from when the game actually appears, so a Steam update before launch isn't counted, and it is saved while you play, so a crash loses at most a few seconds. "Last played" is set when you press Play. Each session is also stored in the `play_sessions` table.

Tracking stops when Vanity is closed; time up to that moment is kept.

## Metadata and artwork

After each scan (and at startup), Vanity fetches details and artwork in the background for games that don't have them yet. Progress shows in the sidebar.

| What | Where from |
| --- | --- |
| Cover, banner (hero), logo, icon | SteamGridDB, top-rated static image. Steam games fall back to Steam's own artwork, with no key needed. |
| Description, genres, release date, developer | IGDB. Steam games fill any gaps from the Steam store, with no key needed. |

**Matching:** Steam games are matched by app ID on both SteamGridDB and IGDB. Other games are matched by name, using a fuzzy comparison that ignores punctuation, ™/®, "GOTY"/"Definitive Edition" and similar, and treats "II" and "2" alike. It only picks a match automatically when it is confident, and different sequel numbers count against a match, so "Hades" won't match "Hades II". A game without a confident match shows **Fix match** on its page.

**Fixing things by hand:**
- **Fix match** (game page, or Edit metadata) searches IGDB, or SteamGridDB if there's no IGDB key. Picking a result re-downloads everything for it, and the match is kept from then on.
- **Change artwork** (right-click or game page) shows SteamGridDB's options for each of cover, banner, logo and icon, or lets you use your own image file. Your pick is kept when metadata refreshes; **Automatic** undoes it.
- **Edit metadata** changes the description, genres, release date and developer. Edited details are kept when metadata refreshes.
- **Refresh metadata** (right-click) refetches one game; **Settings → Refresh all metadata** refetches everything.
- **Settings → Check keys** tests your SteamGridDB key and IGDB credentials.

**Offline and failures:** Everything is cached in `%APPDATA%\Vanity\media` and in the database, so the library works offline. If the services can't be reached, fetching pauses and retries 10 minutes later and on the next start. A rejected key or API error is shown on the game's page instead of crashing anything.

Requests go through Electron's network stack, so Windows proxy settings apply. Rate limits: IGDB about 4 requests per second, SteamGridDB about 6 per second, the Steam store about 1 every 1.6 seconds.

## Accounts and friends

Friends, presence ("Playing X · 23 min") and shared stats use a small account server in [`server/`](server/README.md), backed by **Neon** Postgres. That README walks through creating the Neon database, running the server locally or on Vercel, and pointing Vanity at it, either on the Account page or with `MAIN_VITE_VANITY_API_URL` in `.env.local`. The app only talks to that server, never to the database, so no database credentials ship with the app.

While you're signed in:
- **Heartbeat:** Vanity sends one about every minute, and right away when a game starts or stops.
- **Stats:** your playtime syncs after each session and every 15 minutes.
- **Quitting:** you're marked offline when you quit.

## Controller

Xbox, PlayStation and most other controllers work everywhere in the launcher. Press any button to wake one up; moving the mouse switches back to mouse mode. Turn it off under **Settings → Controller**, which also shows which controller is connected.

| Input | Action |
| --- | --- |
| D-pad / left stick | Move between items |
| A / Cross | Select |
| B / Circle | Back, or close a menu or dialog |
| X / Square | Options (the right-click menu) |
| Y / Triangle | Search, with the on-screen keyboard |
| LB / RB | Previous / next tab |
| LT / RT | Page up / down |
| Right stick | Scroll |
| Start / Options | Play the selected game |
| View / Share | Jump to the sidebar |

On the on-screen keyboard: X is backspace, Y is space, LB/RB is shift, Start is done and B closes it. In the Steam store tab, B goes back a page and the right stick scrolls the store.

## Trending

The **Trending** tab ranks the most popular PC games right now, across stores. There is no single cross-platform ranking API, so `src/main/trending/` aggregates one:

| Module | Job |
| --- | --- |
| `sources.ts` | Fetching: IGDB popularity primitives (cross-platform base ranking) and game details (cover, PC platform filter, store URLs and IDs), Steam current player counts (keyless), Twitch top games and live viewers |
| `aggregate.ts` | Pure functions: build each game's store links and blend the signals into one ranked list of `{ id, title, coverUrl, rank, popularityStat, stores: [{ launcher, storeId, deepLink, webUrl }] }` |
| `launcherLinks.ts` | One entry per store: how to recognise its store URLs, its deep link, its web page and its URI protocol. Add a launcher by adding an entry here. |
| `service.ts` | Caching in SQLite, refresh every 45 minutes and when the tab opens with an old list, error state, opening links |

Ranking: 55% IGDB popularity (Playing, Steam 24h peak players, Visits and Twitch hours watched, weighted) plus 45% the stronger live signal for that game, Steam players or Twitch viewers. So games that aren't on Steam aren't penalised.

The **Most hyped · coming soon** banner at the top slowly scrolls through the top 30 upcoming PC games the most people are following on IGDB ("hypes"), in rank order, with each game's release date, genres and a hype meter. Hover to pause; click to open the game's store page, just like the cards below.

- **Follow** on a card (or in the calendar) and Vanity shows a Windows notification on release day. Followed games are listed under the **Following** tab.
- **Release calendar** lists the same games by release month, soonest first.

Clicking a game opens its only store directly, or a **Choose a launcher** popup when there are several. Launchers whose URI protocol is registered on this PC are marked installed and listed first.

| Store | Opens with |
| --- | --- |
| Steam | `steam://store/<appid>` |
| Epic Games Store | `com.epicgames.launcher://store/p/<slug>` |
| GOG Galaxy | `goggalaxy://openGameView/<product id>` (needs the numeric ID; otherwise the browser) |
| Microsoft Store | `ms-windows-store://pdp/?productid=<id>` |
| Battle.net | `battlenet://<product code>` for the games it knows a code for |
| EA app, Ubisoft Connect | The browser: neither has a documented store-page link |

If a launcher isn't installed or its link fails, the store's web page opens in the browser. Only deep links using the launcher's own protocol, and web pages on the store's own domains, are ever opened.

It uses the same Twitch client ID and secret as IGDB metadata (`MAIN_VITE_IGDB_CLIENT_ID` / `MAIN_VITE_IGDB_CLIENT_SECRET`); without them the tab explains what to add.

## Your data

Everything lives in `%APPDATA%\Vanity`:

- `vanity.db`: the game library (SQLite), including metadata and play sessions
- `media\`: cached artwork, one folder per game
- `settings.json`: settings, custom folders and declined custom-folder finds. API credentials are encrypted with Windows DPAPI via Electron's `safeStorage`, so the file is only readable by your Windows account.

Rescans update games in place, so favorites, hidden flags, playtime and names you changed are kept. A game a scan no longer finds is flagged "Not found" rather than deleted, so an unplugged drive doesn't lose your playtime; it clears again once the game is back.

The schema is versioned with SQLite's `user_version`. Before a schema upgrade, the old file is copied to `vanity.db.v<N>.bak`. If the database is unreadable it is moved aside as `vanity.db.corrupt-<time>` and a fresh one is created; if even that fails, the app runs on an in-memory library for that session and tells you.

Set `VANITY_USER_DATA` to a folder path to run the app with a separate profile.

## Discord Rich Presence

Turn it on in **Settings → Discord** to show what you're doing in Vanity on your Discord profile:

- **Playing a game:** "Vanity", then **Playing \<game>** with an elapsed timer (and the cover, for Steam games).
- **Music player:** **Listening to \<song>** by the artist, with how far into the song you are.
- **Both:** the game on top, with **Listening to \<song>** underneath. Discord shows one timer, which counts the game's time.

**One-time setup:** Discord shows the name of the application that sets the status, so you need your own free one:

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications), click **New Application** and name it **Vanity**.
2. Copy its **Application ID** into Settings → Discord (or put it in `.env.local` as `MAIN_VITE_DISCORD_CLIENT_ID`).
3. Optional: under **Rich Presence → Art Assets**, upload a logo named `vanity`.

The Discord desktop app must be running on the same PC, with **Activity Privacy → Share your detected activities** turned on. Vanity talks to it locally (`src/main/discord/`), with no extra login, and clears your status when you turn the setting off or quit.

## Updates

Vanity updates itself from this GitHub repo, so you never have to delete it and download everything again.

- **Checking:** every minute, in the background. When a new version is pushed, the round button at the top right shows a red **1** and a small red **Update software** banner appears. Clicking either opens the update window: **Update and restart** or **Not now**, with the patch notes for every version since yours.
- **Installing:** Vanity pulls the new code, runs `npm install` if the dependencies changed, rebuilds and restarts. With `npm run dev` it skips the build: electron-vite reloads the app by itself.
- **How it reaches GitHub:** the repo is private.
  - If your copy was made with `git clone` (recommended), updates use git and your normal GitHub login. Nothing else is needed. If git asks for a login, run `git pull` once in the Vanity folder.
  - If you downloaded a zip, add a GitHub token in **Settings → Updates**: a fine-grained token with read-only **Contents** access to this repo. You can also put it in `.env.local` as `MAIN_VITE_GITHUB_TOKEN`. Your `.env.local`, `node_modules` and data are never overwritten.
- **Where updates come from:** the `vanity.updateBranch` field in `package.json`, or for a git clone, the branch it tracks.
- **Patch notes:** come from [`CHANGELOG.md`](CHANGELOG.md). Each release bumps `version` in `package.json` and adds an entry there. The current version is at the bottom right of Settings.
- Installed builds (`npm run dist:win`) don't update themselves. Build a new installer instead.

## Native modules

better-sqlite3 ships a prebuilt N-API binary that works in both Node and Electron, so no Visual Studio or node-gyp setup is needed. `.npmrc` sets `ignore-scripts=true` to stop npm from running an implicit `node-gyp rebuild` for it, and `electron-builder.yml` sets `npmRebuild: false` for the same reason when packaging. `npm run <script>` commands are unaffected.
