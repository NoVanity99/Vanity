# Changelog

Every version of Vanity, newest first. The in-app updater shows these notes before you install.
Format: one `## <version> (<date>)` heading per release, then one `- ` bullet per change.

## 0.3.1 (2026-10-24)
- Updates now come from your Vanity server on Vercel instead of GitHub. Each deploy packs the newest Vanity, and the app downloads it from there, so no GitHub login or token is needed.
- The server address is the one on the Account page. Without one, Vanity falls back to GitHub as before.
- Optional update key: set UPDATE_KEY on the server and the same key in Settings → Updates, so only you can download it.

## 0.3.0 (2026-10-24)
- Discord Rich Presence: turn it on in Settings → Discord to show "Vanity" on your Discord profile.
- Playing a game shows "Playing <game>" with how long you've been playing, and the game's cover for Steam games.
- Using the music player shows "Listening to <song>" by the artist, with how far into the song you are.
- Doing both shows the game on top and the song underneath.
- It needs a free Discord application named "Vanity". Settings → Discord explains the two-minute setup, and shows whether it's connected.
- The server can also be deployed on Vercel as a service under /api.

## 0.2.1 (2026-10-24)
- Settings: 17 new font options, 25 in all, grouped into Clean, Friendly, Gaming and Stylish.
- New fonts: Manrope, DM Sans, Plus Jakarta Sans, Montserrat, Poppins, Nunito, Quicksand, Lexend, Rubik, Sci-fi (Oxanium), Mecha (Chakra Petch), Racing (Russo One), Neon (Audiowide), Retro (Press Start 2P), Poster (Bebas Neue), Sporty (Kanit) and Editorial (Playfair Display).
- Every font is built into the app and works offline.

## 0.2.0 (2026-10-24)
- Updates: a round button at the top right checks GitHub for a new version every minute. When one is out it shows a red badge and a small red "Update software" banner.
- Updates: clicking it shows every change since your version, with "Update and restart" or "Not now". Installing pulls the new code, installs any new dependencies, rebuilds and restarts by itself. No more wiping the folder and downloading everything again.
- Settings: a new Updates section (check now, update channel, GitHub token for downloaded copies). The version number is at the bottom right of Settings.
- Music player: longer and slimmer, with album art, the song's title and artist (scrolling when long), previous, play/pause and next, and an always-visible volume slider.
- Music player: keyboard media keys and the Windows media overlay control it too.
- Trending: the Most hyped banner now slowly scrolls through the top 30 upcoming games.

## 0.1.0 (2026-10-24)
- Library: scans Steam, Epic, GOG, EA, Ubisoft and your own folders, with no duplicates.
- Library: launches games and tracks playtime, with search, sorting, filters, favourites and Surprise me.
- Metadata: artwork and details from SteamGridDB, IGDB and Steam, with Fix match and custom artwork.
- Trending: popular PC games across every store, the Most hyped upcoming games, a release calendar and release reminders.
- Game pages: your stats, milestones, session history, time to beat, ratings, details, media, news, similar games and your journal.
- Extras: Steam store tab, Friends and accounts, stats page, themes and fonts, mini music player, launcher status and full controller support.
