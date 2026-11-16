# Vanity

A unified game launcher for Windows 10/11 and Android. On a PC it finds your Steam, Epic, GOG, EA, Ubisoft and custom-folder games; on a phone it finds every installed game. Either way they show in one dark, cover-art library.

Built with Electron, React, TypeScript, Vite (via electron-vite), Tailwind CSS v4 and SQLite (better-sqlite3).

## Install (Windows)

Download **[Vanity-Installer.exe](https://github.com/NoVanity99/Vanity/releases/latest/download/Vanity-Installer.exe)** and run it. It's a small web installer that looks up the newest release, downloads that version's setup and runs it, so the same file (and link) always installs the latest Vanity. You can also pick a specific `Vanity-Setup-<version>.exe` from the repo's [Releases](https://github.com/NoVanity99/Vanity/releases).

- **What you get:** a Start Menu entry, a desktop shortcut, and an uninstaller in Windows **Apps & features**.
- **SmartScreen:** the installer isn't code-signed, so Windows may show "Windows protected your PC". Click **More info → Run anyway**.
- **Updates:** the installed app keeps itself up to date from GitHub Releases. See [RELEASING.md](RELEASING.md) for how releases are made.

## Install (Android)

On your phone, download **[Vanity-Installer.apk](https://github.com/NoVanity99/Vanity/releases/latest/download/Vanity-Installer.apk)** and open it. It's a small installer that downloads the newest Vanity from GitHub Releases and installs it, so the same file always installs the latest version. Needs Android 6 or newer.

You can also download the app itself: **[Vanity.apk](https://github.com/NoVanity99/Vanity/releases/latest/download/Vanity.apk)** (that link always gives the newest version too).

- **"Install unknown apps":** Android asks you to allow this for your browser the first time, because the app doesn't come from the Play Store. Play Protect may also ask: choose **Install anyway**.
- **Finding games:** Vanity lists every app Android labels as a game, each time it opens. For anything it misses, use **Add a game** and pick the app.
- **Playtime:** for exact times, switch on **Usage access** for Vanity (Settings → Playtime tracking takes you there). Without it, Vanity counts from when you tap Play until you come back.
- **Music:** the player plays the songs stored on the phone, after you allow access to music.
- **Updates:** Vanity checks for a newer version every time it opens, even if the APK you installed was an old one. When there is one, the update window opens: tap **Update now**, Vanity downloads it and Android asks you to install it (allow "Install unknown apps" for Vanity the first time). Your library is kept.
- **Not on Android:** the Steam store tab, Discord status, Big Picture, break reminders, and .exe or web games.

## Getting started (from source)

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
    - **Formats:** MP3, AAC/M4A, FLAC, WAV, OGG/Opus, WebM and MKA play directly. WMA, Apple Lossless, AIFF, WavPack, APE, CAF, AC3, DTS, MP2, AMR and others are converted to FLAC by the bundled ffmpeg (`@ffmpeg-installer`) the first time they play.
    - **Cache:** converted songs are kept in `%APPDATA%\Vanity\music-cache` (the 400 most recently played).
    - **Fallback:** a song the player can't decode is also retried through the converter (`src/main/music/convert.ts`).
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
- **Vibe Check** (Library, or Ctrl+K → "vibe"): pick how much time you have and your mood. Vanity suggests three games from your library with reasons. It weighs how long your sessions usually last for each game, genres, what you're in the middle of, your backlog and ratings, and what you haven't played in a while. The logic is in `src/renderer/src/lib/vibe.ts`.
- **Surprise me** (Library): rolls a random game, favouring ones you haven't played in a while.
- **Search (Ctrl+K):** jump to any game, page, collection or action by typing a few letters. Enter opens; Ctrl+Enter plays a game.
- **Collections:** your own game lists in the sidebar. Click + to make one; right-click a game → **Add to collection**. Each collection's page has Rename and Delete.
- **Break reminders:** Settings → Wellbeing sends a Windows notification every 30 min to 3 h of play.
- **Stats:** totals, streaks, a 14-day chart, the most played games, and **Your year**, a calendar of the last 12 months.
- **Vanity Wrapped:** "Play your Wrapped" on the Stats page turns your last 12 months into story slides. Use the arrows or click to move, Space to pause, Esc to close.
- **Gamer level:** XP comes from minutes played (1 per minute), beating (150) or completing (300) a game, and rating it (20). Your level is under the logo; a recap card after each session shows what you earned.
- **Big Picture mode:** the TV button next to the logo. A full-screen couch view for a controller or keyboard.
- **Ctrl+Alt+V:** brings Vanity to the front from anywhere. Press it again to minimise it.

- **Web games:** "Add a game" accepts an `.html` file as well as an `.exe`.
  - The game opens in its own sandboxed Vanity window (F11 for full screen), served from its folder over `vanity-game://`, so engines that load files with `fetch` work.
  - Each game keeps its own saves (localStorage, IndexedDB). It can't reach Vanity or files outside its folder, and links to websites open in your browser.
  - Playtime counts while the window is open (`src/main/launcher/gameWindows.ts`).
- **Library:** grid or list view, search (Ctrl+F), sort (name, recently played or added, most played, your rating, release date), filter by source, genre or status, and resize cards with the slider. Hover a cover for a quick Play button; right-click for every action. Your most recently played games sit in "Jump back in" at the top.
- **Settings:** rescan, launcher toggles, game folders, API keys with a key check, Refresh all metadata.
- **Themes:** Settings → Appearance has 15 colour skins, defined in `src/shared/themes.ts`. Add one there and it appears in Settings.
- **Fonts:** Settings → Appearance has 25 fonts in four groups (Clean, Friendly, Gaming, Stylish). Some pair a heading font with a body font, such as Poster (Bebas Neue + Montserrat) or Retro (Press Start 2P + Inter). They're all bundled from Fontsource, so they work offline.
  - To add one: `npm install @fontsource-variable/<name>`, import it in `src/renderer/src/main.tsx`, and add an entry in `src/shared/fonts.ts`. A test checks that every font listed there is bundled.
- **Launcher status:** the strip at the top of every page shows whether each store's services are reachable: green when online, red when not. They're checked every 5 minutes; click one to check again. Steam uses its Web API, Epic its public status page, and the others whether their store site answers (`src/main/status/checks.ts`).
- Vanity remembers its window size and position, and opening it again brings the existing window to the front. Animations follow Windows' "Animation effects" setting (reduced motion).

## API keys

Trending and game details need a Twitch client ID and secret (IGDB). Artwork uses a SteamGridDB key.

**They're built in.** `src/main/builtinKeys.ts` holds keys that ship inside every build and installer, so nobody has to enter anything. They're lightly scrambled only so automated secret scanners don't flag and revoke them; anyone can read them, and that's intended.

To use different keys, in order of priority:

1. **In the app:** the Settings → Metadata & artwork section is hidden because the keys are built in. Set `SHOW_API_KEYS = true` in `src/renderer/src/pages/SettingsPage.tsx` to bring it back. Keys entered there are saved encrypted, per PC.
2. **`.env.local` at build time:** run `npm run setup-keys`, or create it by hand:
   ```
   MAIN_VITE_STEAMGRIDDB_API_KEY=...
   MAIN_VITE_IGDB_CLIENT_ID=...
   MAIN_VITE_IGDB_CLIENT_SECRET=...
   ```
   For release builds, add repository secrets with these names instead.
3. **Change the built-in ones:** edit `src/main/builtinKeys.ts`. Each value is the key reversed, then base64-encoded.

Each release build tests the built-in keys and warns in the Actions log if Twitch or SteamGridDB rejects them.

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

Vanity accounts run on **Neon** ([`server/README.md`](server/README.md) has the one-time setup: two keys pasted into GitHub, then one click).

- **Sign-in** is handled by Neon Auth: email and password, "stay signed in", and "forgot password" with a 6-digit code sent by email. Vanity has no password code of its own.
- **Your session** is kept in the operating system's protected storage (DPAPI on Windows, the Keystore on Android), never in a plain-text file. With "Stay signed in" off, it is forgotten when Vanity closes.
- **Friends, presence ("Playing X · 23 min") and shared stats** use the Vanity server, a Neon Function. The app only talks to that server, never to the database, and nothing secret ships with the app.
- **One account per username and per email.** Usernames are unique whatever the capitals (a unique index in the database) and emails are unique in Neon Auth. The sign-up form checks both as you type (`account.availability`) and says "already in use".
- **If something is wrong** the Account page says what: offline, session expired (sign in again), wrong password, username taken.
- **Profile picture and bio:** set on the Account page. The picture is cropped to a square and shrunk to 160×160 in the app (`src/renderer/src/lib/avatarImage.ts`) before it is sent, so only a few kilobytes are stored. Friends see both.
- **Profile looks:** a banner and an animated banner effect, a frame and an aura for the picture, a name effect and a name font, an emoji and a title, picked on the Account page and seen by friends. The effects and auras are CSS animations, stopped when animations are off. The choices are fixed lists (`src/shared/profileStyle.ts`; the server keeps the same lists in `server/src/profileStyle.ts` and refuses anything else), drawn by the stylesheet (`src/renderer/src/styles/index.css`).
- **Messages:** friends can chat in pop-ups at the bottom right (`src/renderer/src/components/ChatDock.tsx`, which shows `FriendChat.tsx`; which pop-ups are open is remembered on the device, `src/renderer/src/state/chats.ts`). Emoji come from a picker (`EmojiPicker.tsx`, list in `src/renderer/src/lib/emoji.ts`), and typed faces like :) turn into emoji. Messages live in the `vanity.messages` table on the server and are never deleted; the app asks for new ones every few seconds while a chat is open.
- **Friend notifications:** the app looks at the friends list every 20 seconds (`src/renderer/src/state/friends.ts`) and turns the differences into cards (`FriendNotifications.tsx`): came online, started a game, sent a message. A Windows notification is added when Vanity isn't in front.
- **Friend profiles:** each friend has a page (`/friends/<id>`, `src/renderer/src/pages/FriendProfilePage.tsx`) with their look, bio, level, most played and recent games and earned badges. It uses what the server already shares with friends (`/friends` and `/friends/:id/stats`); profiles of people who aren't your friends can't be opened.
- **Verified and admin badges** (`src/renderer/src/components/UserBadges.tsx`) show next to a username. Who has them is decided only by the server, from the lists in [`server/src/roles.ts`](server/src/roles.ts).

## Cloud-saved progress, XP and badges

Sign in and your progress is saved to your account and kept the same on every device. Signed out, it all still works and stays on the device.

- **What syncs:** playtime and launch counts per game, last played, favourites, play status, ratings, notes, collections, badges, level and XP, and look-and-feel settings (theme, font, background, controller, break reminder, Discord status, minimise while playing). Folders and paths never sync.
- **How conflicts are settled:**
  - *Counters* (playtime, launches) are kept per device and added up, so two devices used offline never overwrite each other.
  - *Days played and badges* are merged: nothing earned is lost.
  - *Choices* (favourites, status, rating, notes, collections, settings) carry the time they changed. The server's copy wins unless the device's change is newer.
- **Offline:** the local database is always the working copy. Vanity syncs at start, after each play session, a few seconds after you change something, and every 10 minutes; when it can't reach the server it says so on the Profile page and catches up later.
- **Games are matched by name** across devices and stores, so your Steam copy on the PC and the Android version on your phone count as one game.
- **Tuning XP:** every number is in [`src/shared/xpConfig.ts`](src/shared/xpConfig.ts): XP per minute, for the first launch of a game, per day played, the streak bonus and its cap, per Steam achievement, for finishing and rating games, and how much each level takes. XP is always re-worked from what you've actually done, so changing a value re-scores everyone on the next build.
- **Badges** are defined in [`src/shared/progress.ts`](src/shared/progress.ts) (`BADGES`). Add one by adding a line; never rename an existing id.
- **Code:** `src/main/sync/` (the sync engine and progress), `server/src/sync.ts` (the merge rules on the server), `src/shared/sync.ts` (what the two exchange).

## Linked accounts: Steam

Account → **Linked accounts** links a Steam account to your Vanity account.

- **What you can enter:** a SteamID64 (17 digits), a profile link (`steamcommunity.com/profiles/7656…` or `steamcommunity.com/id/yourname`), or just the custom URL name. Names are looked up with Steam's ResolveVanityURL.
- **Sign in through Steam** opens Steam's sign-in page in your browser (OpenID). Vanity never sees the Steam password: Steam tells the Vanity server which account signed in, the server double-checks that with Steam, and links it. These links are marked verified.
- **Private profiles:** if "Game details" is private, Steam shares the name and avatar but not the games. Vanity explains how to change that (Profile → Edit Profile → Privacy Settings → My profile: Public, Game details: Public).
- **Achievements** unlocked on Steam count towards XP (`perSteamAchievement` in `src/shared/xpConfig.ts`).
- **The Steam Web API key is never in the app or this repository.** It is a secret of the Vanity server on Neon. The app calls the server with your sign-in token; the server adds the key, asks Steam and answers. See [server/README.md](server/README.md) for where the key goes.

## Owned games in the library

With a Steam account linked, the Library shows every game you own, installed or not.

- **Not installed** games are greyed out with an **Install** button, and the Library gets an **All / Installed / Not installed** filter.
- **How they get there:** the Vanity server lists your Steam games (`/steam/owned-games`); `src/main/library/owned.ts` keeps the library's "not installed" entries in step with that list, re-applying it after every scan. A scan that finds the game installed turns the same entry into an installed one, so favourites, collections and playtime carry over.
- **Installing** goes through `src/main/install/installer.ts`. Each store has an `Installer` (`canInstall`, `install`). Steam's is `SteamClientInstaller`: it opens `steam://install/<appid>` and Steam does the rest. A SteamCMD-based installer can be added later as another class and placed ahead of it in the list in `src/main/index.ts`; nothing else needs to change.
- **After Install**, `src/main/install/watcher.ts` re-scans the launchers every 30 seconds until the game shows up as installed.
- **Artwork** for not-installed games comes straight from Steam's image servers; the full artwork look-up runs once a game is installed.
- **Windows only.** PC games can't be installed on a phone, so the Android library doesn't list them.

## Installing Epic and GOG games in Vanity (Windows)

The **Downloads** page is a queue: one game at a time, with progress, speed, time left, pause, resume and cancel. It is remembered between launches.

- **The queue** is `src/main/downloads/manager.ts`. Each store is a `DownloadDriver` (`sizes`, `run`, `cleanup`) in `src/main/downloads/drivers.ts`. Before a game is queued, the install window shows its sizes and the free space on the chosen drive, and refuses when there clearly isn't room.
- **Epic** uses [Legendary](https://github.com/derrod/legendary), the open-source Epic client. Vanity ships its unmodified `legendary.exe` (fetched and checksum-verified at build time by `scripts/fetch-legendary.mjs`; licence in `resources/bin/LEGENDARY-LICENSE.txt`) and drives it as a separate program (`src/main/downloads/legendary.ts`): sign-in, the list of owned games, `install` with its progress output read line by line, and `launch`. Pausing stops the program; Legendary continues from where it was. It keeps its sign-in in Vanity's own data folder (`legendary/`), separate from any Legendary or Heroic you already use.
- **GOG** (`src/main/downloads/gog.ts`) signs in on GOG's own page, lists your Windows games, downloads the offline installer (continuing a partial file), then runs it with Inno Setup's silent switches into your install folder. Windows shows its usual permission prompt. GOG has no official public API for this: these are the endpoints GOG's own site and GOG Galaxy use, as the community tools do, and GOG could change them.
- **Steam** stays a hand-off to the Steam client (`SteamClientInstaller` in `src/main/install/installer.ts`), with the note that Steam games install through Steam. A SteamCMD-based installer can be added behind the same interface.
- **Afterwards** the launchers are scanned again, so the game becomes an installed game in the library. Epic games Vanity installed are read from Legendary's own list (`src/main/scanners/epic.ts`) and start through Legendary.
- **Sign-ins** for Epic and GOG happen in a window on the store's own page (`src/main/downloads/desktop.ts`) and stay on this PC. The GOG sign-in is encrypted with Windows credential protection.
- **Troubleshooting:** Downloads → Log opens `logs/downloads.log` in Vanity's data folder, with the downloader's own output.

While you're signed in:
- **Heartbeat:** Vanity sends one about every minute, and right away when a game starts or stops.
- **Stats:** your playtime syncs after each session and every 15 minutes.
- **Quitting:** you're marked offline when you quit.

## Voice rooms

Talk with friends while you play: **Voice** in the sidebar. There are no codes and nothing to set up: voice is built into Vanity's own server.

- **Start a room** and your friends see it: on the Voice page under "Friends in voice", on the Friends page ("In voice", with a Join button), and as a notification. Anyone who is a friend of someone in the room can join. Up to 6 people per room.
- **Private or locked:** whoever started the room picks **Open** (friends see it and can join), **Locked** (friends see it, but only people you invite can join) or **Private** (hidden; invite only). It can be changed during the call. If they leave, the next person to have joined takes over.
- **Invite** sends a friend a chat message with a Join button and lets them in even when the room is locked or private.
- **In a room:** everyone's picture with a green ring while they talk, a crown on whoever started it. Right-click someone to set their volume (0–200%) or mute them for yourself; that's remembered. Mute, deafen and disconnect, and short sounds when people join or leave.
- **Share your screen (Windows):** pick a whole screen or one window, and the quality (720p 30 fps, 1080p 30 fps or 1080p 60 fps). Everyone in the room sees a LIVE badge on you and can click **Watch** to see it big, or full screen. Phones can watch but not share. Sound from the shared screen isn't sent.
- **The voice bar** at the bottom of the sidebar stays while you browse: whose room, connection quality and ping, and your mic buttons. With the sidebar hidden (or on a phone) a small one floats in the corner.
- **Settings → Voice:** microphone and speakers (unplugging one switches to the default and back); a mic test with a live level meter; voice activity (default) with a sensitivity slider drawn on that meter, or push-to-talk with any key or mouse side button; noise suppression, echo cancellation and automatic gain; join/leave sounds.
- **Push-to-talk works while a game is in front:** a system-wide keyboard and mouse hook (`uiohook-napi`, `src/main/voice/hotkeys.ts`) reports the key going down and up. A game run as administrator needs Vanity run as administrator too. If the hook can't load, the key works while Vanity is in front, and Settings says so.
- **Errors are plain words:** no microphone (you join and can listen), microphone blocked by Windows (with where to allow it), no internet, a room that closed, is full or is locked, signed out. A short drop shows "Reconnecting…" and carries on; after 45 seconds without a connection you're taken out of the room (and Vanity tries once to get you back in).
- **Phones:** voice works the same, with a "Hold to talk" button for push-to-talk (no global keys).

**How it's built:**
- **Audio and video:** WebRTC, directly between players (a peer-to-peer "mesh"). Voice is Opus tuned for speech (mono, error correction, silence suppression, at most 64 kbit/s, sent first on a busy connection). A shared screen is one more video line on the same connections, at 2.5–6 Mbit/s depending on the quality picked; stopping only takes the picture off it, so sharing again is instant.
- **Rooms and connection set-up** live on the Vanity server (`server/src/voice.ts`, tables `voice_rooms`, `voice_members`, `voice_invites`, `voice_signals`). During a call the app checks in every 1.5 seconds (every 0.3 seconds while connections are being set up), which keeps your place and brings the connection details the others sent you. No separate voice server and no codes.
- **The engine** is `src/renderer/src/voice/`, with no screen code in it:
  - `client.ts` runs a call (and screen sharing)
  - `audio.ts` is the microphone, talking detection, per-person volume, output device and sounds
  - `mesh.ts` makes the connections
- **Screen picking (Windows):** `src/main/voice/screen.ts` lists screens and windows with thumbnails for Vanity's own picker; the capture only starts for the one picked.
- **Swapping the mesh later:** the screens only see `VoiceTransport` (`transport.ts`), so the mesh can be replaced by a media server (LiveKit, mediasoup) for bigger rooms or many viewers without changing them.
- **Strict networks (TURN):** most home networks connect directly. For the rest, set `TURN_URLS` and `TURN_SECRET` (a coturn shared secret: each player gets their own login that runs out) or `TURN_USERNAME` and `TURN_CREDENTIAL` as GitHub secrets; the deploy passes them to the server, which hands them to the apps. `STUN_URLS` replaces the default public STUN servers. None of these are in the app or the repo.
- **Message format:** shared by the app and the server in `src/shared/voiceProtocol.ts`.
- **Voice settings:** `src/shared/voiceSettings.ts`, kept on the device.

**Two copies on one PC** (to try voice with two accounts): `Vanity.exe --profile=friend` starts a second, separate Vanity with its own sign-in and settings.

**Planned next (not built yet):**
- **An in-game overlay of who's talking:** a see-through, always-on-top window, which works over games in windowed and borderless mode. Exclusive fullscreen would need hooking into the game's graphics, which anti-cheat systems can flag, so that's left out.
- **Sound from a shared screen:** Windows can capture it, but it also captures the voices of the people in the call, who would then hear themselves; that needs filtering first.
- **Text chat inside each room.**

## Customize

Settings → **Customize** switches parts of the launcher on and off and changes how it feels: the start page, which pages are in the sidebar (also: right-click a sidebar tab to hide it, or to bring back a hidden one), the top bar (launcher status, music player, clock), what the Library shows, interface size, corner style, animations and confirmation messages.

- The options and their defaults are one list: `src/shared/interfaceOptions.ts`. They are stored in the settings as `interface` and kept on this device (not synced: a phone and a PC usually want different layouts).
- Size, corners, animations and cover effects are attributes on the page (`data-scale`, `data-corners`, `data-motion`, `data-cover-hover`) that the stylesheet reacts to; the rest is read with `useInterface()` where the piece is drawn.
- To add an option: add it to `InterfaceOptions`, `DEFAULT_INTERFACE` and `normalizeInterface`, read it where it applies, and add its switch in `src/renderer/src/components/settings/CustomizeSettings.tsx`.

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

**No setup needed:** Vanity's Discord application ID is built in (`src/main/builtinKeys.ts`). Discord shows that application's name ("Vanity"). For a logo next to it, upload an image named `vanity` under **Rich Presence → Art Assets** in the application's page on [discord.com/developers/applications](https://discord.com/developers/applications).

The Discord desktop app must be running on the same PC, with **Activity Privacy → Share your detected activities** turned on. Vanity talks to it locally (`src/main/discord/`), with no extra login, and clears your status when you turn the setting off or quit.

## Updates

When run from source, Vanity updates itself from your **Vanity server on Vercel**, so you never have to delete it and download everything again.

- **Checking:** every minute, in the background. When a new version is out, the round button at the top right shows a red **1** and a small red **Update software** banner appears. Clicking either opens the update window: **Update and restart** or **Not now**, with the patch notes for every version since yours.
- **Where updates come from:** every Vercel deploy of the server runs `npm run build` in `server/`. That packs the app, the version from `package.json` and `CHANGELOG.md` into the deployment (`server/scripts/build-update-bundle.mjs`). The server hands them out at `/api/update` (version and notes) and `/api/update/download` (the files). So pushing a new version and letting Vercel deploy is all it takes.
- **Which server:** `MAIN_VITE_VANITY_API_URL` in `.env.local` (e.g. `https://<project>.vercel.app/api`). This is separate from accounts, which run on Neon. Settings → Updates shows which one it uses.
- **Keeping it private:** the bundle is the full app source. To stop anyone else downloading it, set `UPDATE_KEY` (any long random string) in the Vercel project's environment variables. Put the same key in **Settings → Updates** (or `MAIN_VITE_UPDATE_KEY` in `.env.local`).
- **Installing:** Vanity downloads the new files over its own, keeping `node_modules`, your `.env.local` and your data. It runs `npm install` if the dependencies changed, rebuilds and restarts. With `npm run dev` it skips the build: electron-vite reloads the app by itself.
- **Without a server address:** Vanity falls back to GitHub. A git clone updates with git and your GitHub login; a downloaded copy needs a GitHub token in Settings → Updates. The branch is `vanity.updateBranch` in `package.json`.
- **Patch notes:** come from [`CHANGELOG.md`](CHANGELOG.md). Each release bumps `version` in `package.json` and adds an entry there. The current version is at the bottom right of Settings.
- **The Android app** checks GitHub Releases too, and downloads the new `Vanity.apk` for you to install.
- **Installed copies** (from `Vanity-Setup.exe`) don't use any of the above. They update from GitHub Releases: they check when they start and every hour, download in the background, then show "Update ready: restart to install". See [RELEASING.md](RELEASING.md).

## Native modules

better-sqlite3 ships a prebuilt N-API binary that works in both Node and Electron, so no Visual Studio or node-gyp setup is needed. `.npmrc` sets `ignore-scripts=true` to stop npm from running an implicit `node-gyp rebuild` for it, and `electron-builder.yml` sets `npmRebuild: false` for the same reason when packaging. `npm run <script>` commands are unaffected.
