# Vanity

A unified desktop game launcher for Windows 10/11. It finds your Steam, Epic, GOG, EA, Ubisoft and custom-folder games and shows them in one dark, cover-art library.

Built with Electron, React, TypeScript, Vite (via electron-vite), Tailwind CSS v4 and SQLite (better-sqlite3).

## Getting started

```bash
npm install        # no C++ build tools needed (see note below)
npm run dev        # start the app with hot reload
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
    src/pages/       Library, Game detail, Recently played, Favorites, Settings
    src/components/  Sidebar, game grid and cards, context menu…
    src/hooks/       Data hooks over window.vanity
    src/lib/         Small UI helpers
resources/           App icon and build resources
```

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

## Your data

Everything lives in `%APPDATA%\Vanity`:

- `vanity.db`: the game library (SQLite)
- `settings.json`: settings, custom folders and declined custom-folder finds

Rescans update games in place, so favorites, hidden flags, playtime and names you changed are kept. A game a scan no longer finds is flagged "Not found" rather than deleted, so an unplugged drive doesn't lose your playtime; it clears again once the game is back.

The schema is versioned with SQLite's `user_version`. Before a schema upgrade, the old file is copied to `vanity.db.v<N>.bak`. If the database is unreadable it is moved aside as `vanity.db.corrupt-<time>` and a fresh one is created; if even that fails, the app runs on an in-memory library for that session and tells you.

Set `VANITY_USER_DATA` to a folder path to run the app with a separate profile.

## Native modules

better-sqlite3 ships a prebuilt N-API binary that works in both Node and Electron, so no Visual Studio or node-gyp setup is needed. `.npmrc` sets `ignore-scripts=true` to stop npm from running an implicit `node-gyp rebuild` for it, and `electron-builder.yml` sets `npmRebuild: false` for the same reason when packaging. `npm run <script>` commands are unaffected.
