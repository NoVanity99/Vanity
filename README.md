# Vanity

A unified desktop game launcher for Windows 10/11. It finds your Steam, Epic, GOG, EA, Ubisoft and custom-folder games and shows them in one dark, cover-art library.

Built with Electron, React, TypeScript, Vite (via electron-vite), Tailwind CSS v4 and SQLite (better-sqlite3).

## Getting started

```bash
npm install        # no C++ build tools needed (see note below)
npm run dev        # start the app with hot reload
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
    db/              SQLite connection, migrations, repositories
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

## Native modules

better-sqlite3 ships a prebuilt N-API binary that works in both Node and Electron, so no Visual Studio or node-gyp setup is needed. `.npmrc` sets `ignore-scripts=true` to stop npm from running an implicit `node-gyp rebuild` for it, and `electron-builder.yml` sets `npmRebuild: false` for the same reason when packaging. `npm run <script>` commands are unaffected.
