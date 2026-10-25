# Releasing Vanity

Vanity ships as a Windows installer (`Vanity-Setup-<version>.exe`) on GitHub Releases.
Installed copies check GitHub when they start and every hour, download the new version in the background, and show "Update ready: restart to install".

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
6. **Tag and push the tag.** This starts the release:
   ```bash
   git tag v1.2.4
   git push origin v1.2.4
   ```
7. **Watch it build** under the repo's **Actions** tab ("Release" workflow, about 5–10 minutes on a Windows runner). When it finishes, the release appears under **Releases** with:
   - `Vanity-Setup-1.2.4.exe`, the installer;
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

## One-time setup

- **The repo is public**, so installed copies download updates from its Releases without a token.
- **API keys are built in** (`src/main/builtinKeys.ts`), so installers work out of the box.
  - The "Check the built-in API keys" step of each release run says whether they still work. If Twitch or SteamGridDB stops accepting them, update that file and release again.
  - Optional repository secrets `MAIN_VITE_VANITY_API_URL` (account server) and `MAIN_VITE_DISCORD_CLIENT_ID` (Discord app) are baked in too when set.
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
