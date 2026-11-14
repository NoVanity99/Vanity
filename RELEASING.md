# Releasing Vanity

Vanity ships on GitHub Releases as a Windows installer (`Vanity-Setup-<version>.exe`) and an Android app (`Vanity-<version>.apk`). One release, one version number, both platforms.

- **Windows:** installed copies check GitHub when they start and every hour, download the new version in the background, and show "Update ready: restart to install".
- **Android:** the app checks the same release, shows the update button, and downloads the new APK for the user to install (Android doesn't let an app replace itself silently).

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
| Icon | `resources/icon.ico` (multi-size, up to 256×256) and `resources/icon.png` (512×512, used by the window). Replace both files with your own art; keep the names. |
| Installer options (shortcuts, install folder, uninstall) | `nsis:` in `electron-builder.yml` |

## Code signing and SmartScreen

The installer isn't code-signed, so Windows SmartScreen shows **"Windows protected your PC"** the first few times it's run. Click **More info → Run anyway**. The warning gets rarer as more people download a given release, but each new version starts over. Auto-updates still work: electron-updater doesn't require a signature when the app isn't signed.

To remove the warning you need a code-signing certificate:

- **Azure Trusted Signing:** about $10 a month, works with electron-builder.
- **Standard OV certificate:** about $100–400 a year.
- **EV certificate:** more expensive, and gets instant SmartScreen trust.

Ask when you want to set one up: it's a few lines in `electron-builder.yml` and the workflow, plus the certificate as a repository secret.
