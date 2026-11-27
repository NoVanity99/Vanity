# Releasing Vanity

Vanity ships on GitHub Releases as a Windows installer (`Vanity-Setup-<version>.exe`) and an Android app (`Vanity-<version>.apk`). One release, one version number, both platforms.

- **Windows:** installed copies check GitHub when they start and every hour, download the new version in the background, and show "Update ready: restart to install".
- **Android:** the app checks the same release every time it opens, opens the update window, downloads the new APK itself and hands it to Android to install (Android doesn't let an app replace itself silently, so the user taps Install).

## Ship an update

When you say **"make a new release"**, this is the checklist:

1. **Pick the version.** Use [semver](https://semver.org): `1.2.3` → `1.2.4` for fixes, `1.3.0` for new features, `2.0.0` for big breaking changes.
2. **Bump it** in `package.json` and `package-lock.json` (the top-level `version` and `packages[""].version`):
   ```bash
   npm version 1.2.4 --no-git-tag-version
   ```
3. **Write the patch notes** at the top of `CHANGELOG.md`:
   ```markdown
   ## 1.2.4 (2026-11-02)
   - What changed, in plain words: one bullet per change.
   ```
   This text becomes the GitHub Release description and the patch notes Vanity shows in its update window. The release fails if the entry is missing.
4. **Check it builds:**
   ```bash
   npm test
   npm run build
   ```
5. **Commit and push** to the branch you work on (and merge to `main` if you use it):
   ```bash
   git commit -am "v1.2.4: <short summary>"
   git push
   ```
6. **Start the release.** Either:
   - **From GitHub:** go to **Actions → Release → Run workflow** on the branch. It releases the version in `package.json` and creates the `v1.2.4` tag itself. (This is also how Claude releases, since it can only push branches.)
   - **Or tag and push the tag:**
     ```bash
     git tag v1.2.4
     git push origin v1.2.4
     ```
7. **Watch it build** under the repo's **Actions** tab ("Release" workflow, about 10–15 minutes: the Android app builds first, then the Windows installer). When it finishes, the release appears under **Releases** with:
   - `Vanity-Setup-1.2.4.exe`, the Windows installer;
   - `Vanity-1.2.4.apk` and `Vanity.apk` (the same file), the Android app;
   - `latest.yml`, which installed copies read to find the update;
   - `Vanity-Setup-1.2.4.exe.blockmap`, which lets updates download only what changed.

That's it: every installed copy picks the update up within an hour (or on its next start).

### If something goes wrong

- **"Tag does not match package.json version":** the tag and `package.json` disagree. Delete the tag, fix the version, and tag again:
  ```bash
  git tag -d v1.2.4
  git push origin :refs/tags/v1.2.4
  ```
- **A broken release went out:** ship a fixed one with a higher version (e.g. `1.2.5`). Don't reuse a version number, because installed copies only move forward.
- **Building the installer locally** (without publishing): `npm run dist:win` → `dist/Vanity-Setup-<version>.exe`.
- **Building the Android app locally:** needs Java 21 and the Android SDK (`ANDROID_HOME` set). `npm run build:android` → `android/app/build/outputs/apk/release/app-release.apk`.

## The web installer

`installer/Vanity-Installer.exe` is the file to hand out. It reads `latest.yml` from the newest release, downloads the setup it names and runs it, so it never goes out of date.

- **Link that always works:** `https://github.com/NoVanity99/Vanity/releases/latest/download/Vanity-Installer.exe` (the release workflow attaches the file to every release).
- **Rebuilding it** is only needed if `installer/web-installer.nsi` changes: run `npm run dist:win` once (it downloads NSIS), then `node scripts/build-web-installer.mjs`, and commit the new exe.
- Like the setup itself, it isn't code-signed, so SmartScreen shows the same "More info → Run anyway" prompt.

## The Android app

- **Link that always works:** `https://github.com/NoVanity99/Vanity/releases/latest/download/Vanity.apk`. On the phone: open the link, tap the downloaded file, and allow "Install unknown apps" for the browser when Android asks.
- **How it's built:** the same screens as the Windows app, built by `vite.mobile.config.ts` and wrapped in the Android project under `android/`. The phone-only code is `src/mobile/` (TypeScript) and `android/app/src/main/java/com/vanity/launcher/VanityNativePlugin.java` (finding games, starting them, playtime, music).
- **Keep both platforms working:** every feature goes through `VanityApi` in `src/shared/ipc.ts`. A new feature needs a Windows version (`src/main/ipc`, `src/preload`) and an Android version (`src/mobile/api.ts`), or a clear "not on this device" on one of them. `npm run typecheck` fails if either is missing.
- **The signing key is in the repo** (`android/vanity-release.keystore`, password in `android/app/build.gradle`). Android only installs an update over the old app if both are signed with the same key, so every build must use this one. Don't delete or replace it: phones would have to uninstall Vanity (losing their library data) to update.
  - Because the repo is public, anyone could sign their own APK with this key. That's fine for sharing with friends. Before putting Vanity on the Play Store, make a new private key and store it as a repository secret.
- **Play Protect** may warn the first time, like SmartScreen does on Windows: choose "Install anyway".

### The Android web installer

`installer/Vanity-Installer.apk` is the Android file to hand out. It downloads `Vanity.apk` from the newest release and asks Android to install it, so it never goes out of date.

- **Link that always works:** `https://github.com/NoVanity99/Vanity/releases/latest/download/Vanity-Installer.apk` (the release workflow attaches the file to every release).
- **Its code** is `android/installer/`. Rebuilding is only needed if that changes: `npm run build:android-installer`, then commit the new `installer/Vanity-Installer.apk`.
- It is signed with the same key as the app and installs as a separate app ("Vanity Installer"), which can be removed after Vanity is installed.

### The Epic downloader (Legendary)

The release workflow runs `node scripts/fetch-legendary.mjs` before building. It downloads one pinned release of `legendary.exe` from Legendary's GitHub releases into `resources/bin/` and checks its SHA-256; the build fails if the file is anything else. The exe is not committed (`.gitignore`); its licence notice, `resources/bin/LEGENDARY-LICENSE.txt`, is. To move to a newer Legendary, change `VERSION` and `SHA256` in that script together.

## One-time setup

- **The repo is public**, so installed copies download updates from its Releases without a token.
- **API keys are built in** (`src/main/builtinKeys.ts`), so installers work out of the box.
  - The "Check the built-in API keys" step of each release run says whether they still work. If Twitch or SteamGridDB stops accepting them, update that file and release again.
  - The Discord application ID is built in there too.
  - The optional repository secret `MAIN_VITE_VANITY_API_URL` (account server) is baked in when set.
- **Publishing needs no setup.** The workflow uses GitHub's built-in `GITHUB_TOKEN` (with `contents: write`) to create the release.

## App identity

| What | Where |
| --- | --- |
| Name ("Vanity") | `productName` in `package.json` and `electron-builder.yml` |
| Version | `version` in `package.json` |
| Publisher (shown in Apps & features) | `author.name` in `package.json` |
| Icon | `resources/icon.ico` (multi-size, up to 256×256) and `resources/icon.png` (512×512, used by the window). Replace both files with your own art; keep the names. The Mac icon is `resources/mac/icon.icns`, made from `resources/mac/icon.svg` (see The Mac app). |
| Mac app settings (bundle ID `com.vanity.launcher`, games category, macOS 12 or newer, the .dmg window) | `mac:` and `dmg:` in `electron-builder.yml` |
| Installer options (shortcuts, install folder, uninstall) | `nsis:` in `electron-builder.yml` |

## The Mac app

Every release also builds the Mac app on GitHub's Mac machine (the `mac` job in
`.github/workflows/release.yml`): one Universal app for Apple Silicon and Intel, as
`Vanity-<version>-universal.dmg`, plus a `.zip` and `latest-mac.yml` used for updates. The job checks
the app before anything is published: both chips are in it (`lipo`), the signature is valid
(`codesign --verify --deep --strict`), the .dmg opens and has Applications in it, and the app itself
starts, finds a test Steam game and a test Mac game, and starts the Mac game
(`scripts/mac-smoke.mjs`). The `mac-release` job then attaches the files to the release. A problem
with the Mac build never holds up the Windows and Android release.

To build it yourself, on a Mac: `npm install`, then `npm run build:mac`. The .dmg lands in `dist/`.

The icon (`resources/mac/icon.icns`) and the installer window's background
(`resources/mac/background.png` and `background@2x.png`) are made from `resources/mac/icon.svg` and
`resources/mac/dmg-background.html` by `node scripts/make-mac-assets.mjs`. Run it again after
changing either.

### Mac signing

Without an Apple Developer account the app is **ad-hoc signed**, which every Mac (Apple Silicon
included) accepts after the one-time "Open anyway" in INSTALL-MAC.md. Such a copy can't update
itself: macOS's updater only installs into an app signed with a Developer ID, so Vanity shows the new
version with a **Download** button that opens the release instead.

With an Apple Developer account ($99 a year), add these repository secrets and the next release is
signed with your Developer ID, notarized by Apple (no warning when opening it) and updates itself like
on Windows:

| Secret | What it is |
| --- | --- |
| `MAC_CERTIFICATE_P12_BASE64` | Your "Developer ID Application" certificate, exported from Keychain Access as a .p12 file, then base64-encoded (`base64 -i cert.p12 \| pbcopy`) |
| `MAC_CERTIFICATE_PASSWORD` | The password you gave the .p12 when exporting it |
| `APPLE_ID` | The Apple ID email of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password made at appleid.apple.com (Sign-In and Security) |
| `APPLE_TEAM_ID` | Your 10-character Team ID (developer.apple.com → Membership) |

Never put any of these in the repository.

## Code signing and SmartScreen

The installer isn't code-signed, so Windows SmartScreen shows **"Windows protected your PC"** the first few times it's run. Click **More info → Run anyway**. The warning gets rarer as more people download a given release, but each new version starts over. Auto-updates still work: electron-updater doesn't require a signature when the app isn't signed.

To remove the warning you need a code-signing certificate:

- **Azure Trusted Signing:** about $10 a month, works with electron-builder.
- **Standard OV certificate:** about $100–400 a year.
- **EV certificate:** more expensive, and gets instant SmartScreen trust.

Ask when you want to set one up: it's a few lines in `electron-builder.yml` and the workflow, plus the certificate as a repository secret.
