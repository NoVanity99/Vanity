# Changelog

Every version of Vanity, newest first. The in-app updater shows these notes before you install.
Format: one `## <version> (<date>)` heading per release, then one `- ` bullet per change.

## 0.12.0 (2026-11-14)
- New: **link your Steam account** (stage 3 of the accounts and cloud update). On the Account page there is a new "Linked accounts" section.
  - Paste any of: your SteamID (17 digits), your profile link (steamcommunity.com/profiles/… or steamcommunity.com/id/yourname), or just your custom URL name.
  - Or click "Sign in through Steam": Steam's own sign-in page opens in your browser and the link fills in by itself. Vanity never sees your Steam password. Accounts linked this way get a verified tick.
  - Once linked you see your Steam name and avatar, how many games you own and how many achievements you've unlocked, with an Unlink button.
  - If your Steam profile's game details are private, Vanity says so and shows the five steps to make them public.
  - The link is saved to your Vanity account, so it shows on every device.
- Steam achievements now count towards your XP and level, and the "Achievement Hunter" badge can be unlocked. Big libraries are counted over a few minutes.
- The Steam key that makes this work lives only on Vanity's server. It is not in the app. Each account has limits on how often it can ask, and answers are remembered for a few minutes.

## 0.11.1 (2026-11-14)
- New: a red **cancel** bubble next to "Starting…" when a game is starting. Click it to stop waiting; if the game had already opened, it is closed too.
- New: a red **close game** bubble at the top right of a game's cover while it is running (also next to the Playing button on the game page, in Jump back in, the list view and Big Picture). It ends the game the way "End task" in Task Manager does.
  - It asks once first ("Close game?"), because unsaved progress in the game is lost. Click again to confirm.
  - Only the game's own program and anything running from its install folder is closed. Time played up to that moment is kept.
  - Web games close their window. On Android, Vanity asks the system to close the game (Android decides).
- "Launching…" now reads "Starting…".

## 0.11.0 (2026-11-14)
- New: **cloud-saved progress** (stage 2 of the accounts and cloud update). Sign in and your progress follows you to every PC and phone.
  - Synced: playtime and launch counts per game, last played, favourites, play status, ratings and notes, collections, badges, your level and XP, and your look-and-feel settings (theme, font and similar).
  - Play on two devices and the time adds up; nothing overwrites anything. For choices like favourites, the newest change wins.
  - Works offline: everything is saved on the device first and syncs by itself when you're back online.
  - Not signed in? Everything still works and is kept on this device.
- New: **Profile page** (click your level in the sidebar, or Profile in the menu): your level and XP bar, total playtime, games played, launches, streak, most-played games, where your XP comes from, and your badges.
- New: **21 badges** to unlock, from "Press Start" to "Unstoppable" (a 30-day streak), each showing how far along you are.
- XP now also comes from the first launch of each game, each day you play, and streaks of days in a row, on top of playtime, finishing and rating games. Steam achievements will count once Steam linking arrives. Your level can only have gone up.
- Friends: you can see each friend's level, XP and badge count.
- Game time shown in the library and on Stats now includes your other devices.

## 0.10.0 (2026-11-14)
- Accounts have moved to Neon, with proper sign-in (stage 1 of the accounts and cloud update).
  - Create an account with your email, a username and a password. Friends still add you by username; your email stays private.
  - "Stay signed in" keeps you signed in between launches. Turn it off on a shared PC and Vanity forgets you when it closes.
  - Forgot your password? Vanity emails you a 6-digit code to choose a new one.
  - Your sign-in is stored in the device's protected storage (Windows credential protection, Android Keystore), never in a plain file.
  - Clear messages when you're offline, when your session has expired, for a wrong password, or when a username is taken.
  - Works the same on Windows and Android.
- Accounts from before this version don't carry over: create a new one with your email. Your library, playtime and settings on this device are untouched.
- Friends, "now playing" and shared stats work as before, now on the new accounts.

## 0.9.2 (2026-11-14)
- New: **Vanity Installer for Android** (Vanity-Installer.apk), a small app to hand out. It always downloads the newest Vanity from GitHub Releases and installs it, so the same file can be shared forever.
  - Open it and it finds the newest version, downloads it with a progress bar, and Android asks you to install.
  - If Vanity is already on the newest version it says so and offers to open it.
  - Once Vanity is installed you can remove the installer: Vanity keeps itself up to date.

## 0.9.1 (2026-11-14)
- Android: Vanity now keeps itself on the newest version, however old the APK you installed is.
  - It checks for a newer version the moment it opens, and again each time you come back to it.
  - When there is one, the update window opens by itself. Tap "Update now": Vanity downloads the new version inside the app, shows the progress, and Android asks you to install it.
  - The download link for the APK always gives the newest version too.

## 0.9.0 (2026-11-14)
- New: **Vanity for Android.** Install Vanity.apk on your phone and it finds every game installed on it, the same way the Windows app finds your PC games.
  - Tap a game to play it. Touch and hold a game for its menu (favourite, hide, collections, remove).
  - "Add a game" lists every other app on the phone, for games Android doesn't label as games.
  - Playtime: turn on "Usage access" in Settings for exact times. Without it, Vanity counts from when you tap Play until you come back.
  - The music player plays the songs stored on your phone.
  - Cover art, game pages, Most hyped, Stats, Wrapped, Vibe Check, collections, accounts and friends all work like on Windows.
  - Updates: Vanity tells you when a new version is out and downloads the new APK for you to install.
  - Not on Android: the Steam store tab, Discord status, Big Picture, break reminders, and .exe or web games.
- Vanity now scans for new games every time it opens, on Windows and Android.
- No more duplicates: if the same game is found twice (for example on Steam and Epic), it shows once. Vanity keeps the copy you've played the most.
- A game you remove stays removed, even after a rescan. Settings has a "Removed games" list to bring them back.
- Fonts: changing the font in Settings now changes all the text in the launcher, including headings, buttons, menus and text boxes.
- Fixed: a few small font pieces were blocked from loading, so some special characters could show in the wrong font.

## 0.8.1 (2026-11-14)
- New: a small web installer, Vanity-Installer.exe. It always downloads and installs the newest version of Vanity, so the same file can be shared forever.

## 0.8.0 (2026-11-07)
- Music player: plays almost any audio format, not just MP3 and the common ones.
  - Newly supported: WMA, Apple Lossless (ALAC) .m4a, AIFF, WavPack, APE, CAF, AC3/E-AC3, DTS, MP2, W64, AMR and more.
  - Vanity converts them to lossless FLAC with its built-in converter the first time they play, and keeps the result, so they start instantly and seek properly after that.
  - Any song the player can't decode is automatically retried through the converter before it's skipped.
- Web games: "Add a game" now accepts .html files as well as .exe.
  - Web games open in their own Vanity window. Press F11 for full screen.
  - Saves are kept between plays, and games that load their own files (Phaser, Godot, Unity WebGL, Construct and similar) work.
  - Playtime, session recaps, break reminders and Discord all work just like any other game.
  - The game window can't touch the rest of your PC, and links to websites open in your browser.

## 0.7.0 (2026-10-26)
- New: **Vibe Check**, for when you can't decide what to play. Click Vibe Check at the top of your Library, or search "vibe" with Ctrl+K.
- Pick how much time you have (15 minutes up to all night) and your mood: Chill, Intense, Story, Quick fix, Social or Something new.
- Vanity picks three games from your library, with a match score and the reasons for each. For example: "Your sessions usually run 45 min, which fits 1 hour", "You're in the middle of it", or "You haven't played it in 10 months".
- It learns from how you actually play: how long your sessions usually run for each game, what you're in the middle of, your backlog, your ratings, and what you haven't touched in a while. It never suggests games you dropped.
- Hit Play straight from the card, or "Show me others" for the next best matches.

## 0.6.1 (2026-10-26)
- Settings is simpler: the API keys and the Discord application ID are built in, so the "Metadata & artwork" section and the Discord ID field are gone. Discord Rich Presence works as soon as you turn it on.

## 0.6.0 (2026-10-25)
- Vanity is now a real Windows app. Install it with Vanity-Setup.exe from GitHub Releases. You get a Start Menu entry, a desktop shortcut, and an uninstaller in Windows "Apps & features".
- Automatic updates for the installed app. Vanity checks GitHub for a new version when it starts and every hour, and downloads it in the background without getting in your way.
- When an update is ready, a small "Update ready: restart to install" notice appears. If you don't restart, it installs the next time you quit.
- If you're offline or GitHub is down, Vanity says nothing and tries again later.
- The API keys for Trending, game details and artwork are built in, so nobody has to enter any.

## 0.5.0 (2026-10-25)
- Big Picture mode: a full-screen, couch-friendly view. Open it with the TV button next to the Vanity logo, or "Big Picture" in Ctrl+K search.
  - It shows big cover rows for Continue playing, Favorites, your backlog, each collection and all games, with the selected game's art filling the screen.
  - Controls: arrows or a controller to move, Enter or A to play, Esc or B to exit.
- Vanity Wrapped: your last 12 months of gaming as animated story slides.
  - The slides cover total hours, your game of the year, top 5, top genre, night owl or early bird, longest session and streak, and your level.
  - Start it from "Play your Wrapped" on the Stats page.
- Gamer level and XP: earn XP for every minute played, for beating or completing games, and for rating them.
  - Your level, title (Rookie to Mythic) and progress show under the logo.
- Session recap: when you close a game, a card shows how long you played, your total time and the XP you earned. It also shows any level-up or milestone you unlocked.
- Ctrl+Alt+V from anywhere, even mid-game, brings Vanity to the front. Press it again to tuck Vanity away.

## 0.4.0 (2026-10-25)
- Collections: make your own game lists ("Co-op nights", "Backlog 2026"…) with the + next to Collections in the sidebar. Right-click any game → Add to collection. Each collection has its own page, which you can rename or delete.
- Search everything with Ctrl+K (or the Search button at the top of the sidebar). Type a few letters, like "tw3" for The Witcher 3, to jump to a game, page, collection or action. Ctrl+Enter plays a game straight away.
- Library list view: switch between covers and a compact list showing status, your rating, playtime and last played.
- Break reminders: Settings → Wellbeing can nudge you to take a break every 30 minutes to 3 hours of play.
- Stats: "Your year" shows a calendar of the last 12 months of play, with your total hours, active days, best day and longest streak. Hover a day to see its playtime.

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
