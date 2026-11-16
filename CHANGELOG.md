# Changelog

Every version of Vanity, newest first. The in-app updater shows these notes before you install.
Format: one `## <version> (<date>)` heading per release, then one `- ` bullet per change.

## 0.27.1 (2026-11-16)
- Fixed: **picture auras on your account card** (bottom left) were cut off at the edges and the wrong size. They now show in full, sized to fit the picture everywhere.
- Fixed: **Jump back in** disappeared whenever a Library filter was left on (a launcher, genre, status, or installed / not installed), and filters are remembered between launches, so it could stay gone. It now always shows, narrowed by your filters, and hides only while you search. Games you've played but haven't installed show there too, with an **Install** button.
- Fixed: a game you'd launched for zero seconds could appear in Jump back in as "Never played".

## 0.27.0 (2026-11-16)
- New: **cameras in voice rooms.** The **Camera** button turns your camera on for everyone in the room; your video fills your tile (with the green ring glowing around it while you talk). It works alongside screen sharing: the screen in the big view, cameras in the tiles. Pick which camera in Settings → Voice. Works on phones too (Android asks for camera permission the first time).
- Fixed: when someone is muted **and** deafened, both marks now show, not just one.

## 0.26.0 (2026-11-16)
- New: **group chats.** On the Friends page, **New group chat** picks friends (and a name). It opens in the same pop-ups as your other chats, with everyone's picture and name. Anyone in it can rename it and add their friends; whoever made it can remove people. Up to 20 people.
- New: **GIFs in every chat.** The **GIF** button next to emoji searches GIFs (trending ones show first), or sends a GIF from your PC or phone (up to 3 MB).
  - GIF search needs a free KLIPY key added to the server once (see the release notes on GitHub); until then, sending GIFs from your device works.
- New: **notifications everywhere.** A friend coming online, starting a game (with its name), sending you a message (with what they wrote), and messages in group chats now show as a card in Vanity **and** as a Windows notification or, on phones, an Android notification. Click one to open that chat or profile.
  - Settings → Customize → **Windows notifications**: while Vanity isn't in front (default), always, or never. A new switch for group chat messages too.
  - On Android, Vanity asks once for permission to show notifications.
- New: **public profiles.** Anyone signed in can see your profile and stats by default. Pick who can on the Account page: **Everyone**, **Friends** or **Only me**. Find any player by name with the search box on the Friends page, open their profile, and add them from there.
- Fixed: **Jump back in** could lose games (most often after an update) until you played them again. A game's last-played time now comes back from its play history, and a game found in two places keeps the latest play of both.
- Changed: the **Updates** settings show just the **Check now** button and its status.

## 0.25.0 (2026-11-16)
- New: **game details in Big Picture.** **Details** (or **X** on a controller) opens a full-screen details screen sized for a TV, without leaving Big Picture.
  - Big buttons for **Play** (or **Install**), **Close game** while it's running, **Favorite**, **Open folder** and **Full page**.
  - Set the game's **status** and **your rating** right there.
  - Your playtime, sessions, last played, average and longest session, and rank; the description, time to beat and screenshots (open one full screen).
  - **Everything works with a controller:** the d-pad moves between buttons, **A** presses, **B** goes back to the same game in the rows, **Menu** plays, the right stick scrolls.
- New: **reorder the sidebar.** Press and hold any tab, then drag it up or down. The order is saved for good (Library can move too). Right-click a tab → **Reset tab order** to go back to the original.

## 0.24.0 (2026-11-16)
- New: **share sound with your screen (Windows).** Turn on **Share sound** in the screen picker.
  - Sharing a **window** (a game, a video) sends only that program's sound.
  - Sharing a **whole screen** sends everything you hear **except Vanity**, so nobody in the call hears their own voice coming back.
  - Viewers hear it only while they watch your screen, with their own **stream volume** slider and mute, and a small meter that lights up when sound is coming through.
  - Needs Windows 10 (version 2004 or newer) or Windows 11. If sound can't be shared, your screen is still shared and Vanity says why.
- New: **pop out a shared screen.** **Pop out** opens the stream in its own window: move it anywhere, even another monitor, make it **full screen** (button, double-click or F), or **keep it on top**. It keeps playing, with sound, while you use the rest of Vanity. **Bring it back** puts it on the Voice page again.
- Faster and smoother voice and video:
  - Connections are set up sooner: Vanity checks in more often while connecting, sends connection details faster, and gathers network routes up front.
  - Shared screens prefer H.264, which most PCs and phones encode and decode on the graphics card: less delay and fewer dropped frames. Games (60 fps) keep motion smooth; text and pictures stay sharp.
  - Pictures and sound play as soon as they arrive, with no extra waiting.
  - Shared sound is sent in stereo at high quality; voice stays tuned for speech.
- Changed: the **launcher status** dots (Steam, Epic, EA…) at the top are **off by default**. Turn them back on in Settings → Customize → Launcher status.
- Changed: removed the "No codes needed" line under **Start a room**, and the "Updates from GitHub Releases" line under **Check now** in Settings.

## 0.23.0 (2026-11-16)
- Changed: **voice rooms need no codes and no voice server.** Voice is now built into Vanity itself.
  - **Start a room** and your friends see it: on the Voice page under **Friends in voice**, on the Friends page (**In voice**, with a **Join voice** button), and as a notification. Friends of anyone in the room can join.
  - **Open, Locked or Private:** whoever starts the room picks who can get in, and can change it during the call. **Locked** rooms are seen but only people you invite can join; **Private** rooms are hidden and invite only. A crown shows who started the room; if they leave, the next person takes over.
  - **Invite** sends a friend a chat message with a **Join voice room** button, and lets them in even when the room is locked or private.
  - The voice server address is gone from **Settings → Voice**.
- New: **share your screen in voice (Windows).** **Share screen** opens Vanity's picker: a whole screen or one window, with a live picture of each, and the quality (720p 30 fps, 1080p 30 fps or 1080p 60 fps).
  - Everyone in the room sees **LIVE** on you and can click **Watch** to see it big, or full screen. Friends see **LIVE** on your room before they join.
  - You get a small preview of what you're sharing. **Stop sharing** ends it, and so does closing the shared window.
  - Phones can watch shared screens but can't share. Sound from the shared screen isn't sent yet.
- New: **right-click any tab in the sidebar to hide it.** The same menu shows the hidden tabs, to bring them back with one click. Library and Settings always stay.
- New: **more profile looks**, seen by your friends too:
  - **Banner effects:** snow, twinkling stars, embers, hearts, bubbles, rain, fireflies, scanlines or a shine.
  - **Picture auras:** pulse, orbit, halo, sparkle, flames, glitch, ripples or prism.
  - **Name fonts:** 13, from Orbitron and Pixel to Playfair and Mono.
  - **Titles** under your name, like "Night owl", "Speedrunner" or "Final boss".
  - They stop moving when animations are turned off in Settings → Customize.

## 0.22.0 (2026-11-16)
- New: **voice rooms.** Talk with friends while you play: **Voice** in the sidebar.
  - **Rooms:** start one to get a 6-character code, or join with a code (however it's typed). Up to 6 people. **Invite** sends a friend the code as a chat message, which shows them a **Join voice room** button.
  - **In a room:** everyone's picture and name, with a **green ring that glows while they talk**. Short sounds when people join or leave, and when you mute or deafen.
  - **Mute, deafen and disconnect.** Right-click someone (or use the ··· button) to set **their volume from 0 to 200%** or **mute them just for you**. Remembered for next time.
  - **The voice bar** at the bottom of the sidebar stays while you browse other pages: the room, connection quality and ping, who's talking, and your mic buttons. When the sidebar is hidden, a small one floats in the corner.
  - **Push-to-talk** with any key or mouse side button, and it **works while a game is in front**. Voice activity is the default, with a sensitivity slider.
  - **Dropped connections reconnect by themselves**, back into the same room, even if the voice server restarts.
  - Clear messages when something's wrong: no microphone (you can still listen), microphone blocked by Windows (with where to allow it), the voice server can't be reached, a wrong code, a full room, signed out.
- New: **Settings → Voice:**
  - the voice server address
  - microphone and speakers, switching to the default when one is unplugged and back when it returns
  - a **mic test with a live level meter**, and "let me hear myself"
  - the sensitivity mark drawn on that meter
  - push-to-talk key and release delay
  - noise suppression, echo cancellation and automatic gain control
  - sounds on or off
  - All of these are kept between launches.
- On phones, voice works the same, with a "Hold to talk" button for push-to-talk. Android asks for microphone permission the first time you join.
- New: `Vanity.exe --profile=name` starts a second, separate copy of Vanity (its own sign-in and settings), for trying voice with two accounts on one PC.
- Voice needs a **voice server**: see `server/voice/README.md` to run one on your PC or put it online, and to add a TURN server for strict networks.

## 0.21.0 (2026-11-16)
- Changed: **chats are pop-ups.** Message (on the Friends tab or a friend's page), or clicking a message notification, opens the chat in a pop-up at the bottom right of the window. It stays open while you move around Vanity, and comes back after a restart. Up to three can be open side by side.
  - **Minimize** (or click the pop-up's title) folds it into a small bar that shows how many new messages are waiting; click the bar to open it again.
  - **Close** removes the pop-up only: the conversation is kept for good, and opening the chat again shows all of it.
  - The pop-up's title shows your friend's banner, picture, name and what they're doing, with a button to open their profile.
  - On a phone the chat fills the width above the bottom bar.
- New: **emoji in chats.** A smiley button next to the message box opens an emoji picker (eight groups, plus the ones you used last). Typed faces turn into emoji when you add a space after them, for example :) 🙂, :D 😄, ;) 😉, :( 🙁, :P 😛, <3 ❤️. A message that is just one to three emoji is shown big.
- The small messages in the corner now sit above the chat pop-ups instead of behind them.

## 0.20.0 (2026-11-16)
- New: **messages between friends.** Every friend's page has a chat box, and the Friends tab has a Message button. Type and press Enter (Shift+Enter for a new line). Messages are kept on Vanity's server for good, so the whole chat is there on every device: the newest messages load first and "Earlier messages" pages back to the very first one. New messages arrive by themselves every few seconds while the chat is open, and "Seen" shows under your last message once your friend has read it. Only friends can message each other, and nobody else can read a chat.
- New: **notifications for friends**, as a card in the top-right corner with their banner, picture and name: when a friend **comes online**, when they **start a game** (with the game's name), and when they **send you a message** (with the message). Click a card to open their page or the chat. When Vanity isn't the window in front, a Windows notification is shown too. Each of the three can be turned off in Settings → Customize → Friend notifications.
- New: **the Friends entry in the sidebar shows how many friends are online** (green, with a dot), and a red bubble with the number of unread messages. Friends in the list show their latest message and their own unread count.
- Changed: **friend pages show much more.** Covers for their most played, favourite, recent and currently played games (yours if you have the game, otherwise looked up by name); a "Playing now" box with the game's cover; launches, days played, current and best streak, games finished, average rating, when they joined, how long you've been friends, how many friends they have and how many you share, their linked Steam account, how many messages you've exchanged; their favourites and what they are playing these days; your own playtime next to theirs for games you both have; and the date each badge was earned. Their private notes on games are never shared.
- Fixed: **the Vanity logo and name in a narrowed sidebar.** The logo keeps its full shape at every width and the name is no longer cut off (the narrowest the sidebar goes is now 220 pixels).
- The Friends page now updates together with the sidebar, every 20 seconds and whenever you come back to the window.

## 0.19.1 (2026-11-15)
- Fixed: **the button that brings a hidden sidebar back couldn't be clicked on Windows.** It sat on the strip at the top of the window that you drag the window by, and Windows treated the click as a drag. The button is now part of that strip, marked as clickable the same way the music player and launcher status are.

## 0.19.0 (2026-11-15)
- New: **the sidebar can be resized and hidden.** Drag its right edge to make it wider or narrower (200 to 420 pixels; double-click the edge to put it back). A small button at the top of the sidebar hides it completely, and a small button in the top-left corner brings it back. Both are remembered, and are also in Settings → Customize → Sidebar. Computers only: on phones the sidebar is already a slide-out menu.
- Fixed: in a small window, scrolling the sidebar made **the highlight of the current page slide over the search box and level bar**. The highlight now stays inside the list: the part that scrolls out is cut off, and it is gone when its page has scrolled out of view.
- Changed: **one account per username and per email, and Vanity always says so.**
  - While you type in Create account, a line under the field says "That username is already in use." or "This username is available." (capitals don't matter: "Max" and "max" are the same name), and the same for the email where the server can check it. The Create account button won't go ahead with one that is in use.
  - Pressing Create account with a used email always answers "That email is already in use. Sign in instead, or use another email.", and nothing is created.
  - Renaming to someone else's username gets the same answer.
  - The database itself refuses a duplicate username, and the sign-in service refuses a second account for an email, so this holds even if two people try at the same moment.

## Server update (2026-11-15)
- **chefdal** is now a verified account and an admin. No app update is needed: the badges appear by themselves.

## 0.18.0 (2026-11-15)
- New: **many more profile looks to pick on the Account page.**
  - **Banners: 26** (was 12). New: Lava, Mint, Midnight, Rose, Toxic, Arctic, Royal, Peach, Carbon, Nebula, Retro grid, Blood moon, Matrix and Cotton sky.
  - **Picture frames: 18** (was 8). New: Silver, Emerald, Ruby, Sapphire, Sunset, Toxic, and four that turn: Void, Pastel, Plasma and Candy.
  - **Name effects: 16** (was 7). New: Fire, Mint, Rose, Silver, Toxic, Royal, Candy, and two that move: Aurora and Lava flow.
  - **Emoji next to your name: 55** (was 20).
- Friends on an older version of Vanity see a new look as the plain default until they update.

## 0.17.2 (2026-11-15)
- Changed: **in the Friends tab, each friend's banner fills their row** instead of a plain dark background. Friend requests show the sender's banner the same way. A friend who hasn't picked a banner gets the soft default one, and the friend you've selected is marked with a bright outline.

## 0.17.1 (2026-11-15)
- Fixed: **"If you like this" on a game page now takes you somewhere.** Clicking a game you don't own used to do nothing. It now looks up the stores that game is sold on and lets you pick one (Steam, Epic, GOG, EA, Ubisoft, Battle.net, Microsoft Store): it opens in that launcher if you have it installed, otherwise in your browser, so you can buy it. Hovering a game shows "Where to buy". If Vanity can't find the game's own store pages, it opens a Steam search for its name and says so. Games you already own still open their page in your library.

## 0.17.0 (2026-11-15)
- New: **friend profile pages.** Open a friend's own page from the Friends list (press "View profile", or click their picture or name in the panel) or from "friends who played this" on a game page. It shows their banner, framed picture, styled name, badges and bio, whether they are online or what they are playing, their level and XP, playtime and games played, their favourite game, how many of their most played games you have too, their ten most played games (click one you own to open it in your library), what they played recently and the badges they have earned. It keeps itself up to date while open.
- New: **your banner shows behind your account** at the bottom of the sidebar, so the look you picked is visible on every page.

## 0.16.3 (2026-11-15)
- Changed: **verified and admin badges now arrive live.** When a badge is granted (or taken away) on the server, every running copy of Vanity picks it up within about a minute, with no app update and no restart: the app's once-a-minute check-in with the server now brings the account's badges back with it. Friends see it the next time their Friends list refreshes (every 30 seconds while it is open).
- **Max** is now a verified account.

## 0.16.2 (2026-11-15)
- Changed: **the Account page fills the whole page too.** Your account (or the sign-in form) is on the left and Linked accounts on the right, instead of one narrow column in the middle. On a small window or a phone they stack as before.

## 0.16.1 (2026-11-15)
- Changed: **Settings fills the whole page.** It used to sit in a narrow column in the middle with empty space either side. Now the cards use the full width: two columns side by side on a normal window (three on a very wide one), and the skin and font pickers show more per row. On a small window or a phone they stack as before.

## 0.16.0 (2026-11-15)
- New: **a round rescan button next to the Library title.** One click rescans your launchers; it spins while scanning and tells you when your library is already up to date. It is on Library, Recently Played and Favorites.
- New: **profile looks.** On the Account page, under your picture and bio, pick a banner (12), a frame around your picture (8, three of them slowly turning), an effect for your name (7, including an animated rainbow) and an emoji next to it (20). A preview shows the result as you pick. The look is saved to your account and shows to you and your friends everywhere your name appears: sidebar, Profile, Friends, friend requests and "friends who played this". The server only accepts looks from Vanity's own lists.
- New: **the Most Hyped row on Trending can be dragged.** Click and hold (or use a finger) and pull it left or right; it glides a little when you let go and wraps around. A plain click still opens the game, and it still pauses under the mouse.
- New: **Settings → Customize**, with 25 options that apply at once and are kept on this device:
  - **Start page:** the page Vanity opens on.
  - **Sidebar:** show or hide each page (Trending, Steam Store, Friends, Recently Played, Favorites, Stats, Profile, Downloads), the level ring, the search box, collections and the game counts.
  - **Top bar:** launcher status, the music player, and a clock (12- or 24-hour).
  - **Library:** Jump back in, player counts, favourite stars and status labels, game names under covers, the Vibe Check and Surprise me buttons, and what covers do under the mouse.
  - **Look and feel:** interface size (compact, normal, large), corners (round, soft, square), animations on or off, and the small confirmation messages.
  - **Reset to defaults** puts everything back.

## 0.15.0 (2026-11-14)
- New: **profile picture and bio.** On the Account page you can add a picture (Vanity crops and shrinks it), change it, remove it, and write a bio of up to 200 characters. Both are saved to your account, follow you to every device, and show to your friends. Works on Windows and Android.
- New: **verified and admin badges.** A blue bubble with a check mark for verified accounts and a gold bubble with a crown for admins, side by side when an account has both, each with a light that sweeps across it. They show next to the name everywhere: sidebar, Account, Profile, Friends, friend requests and "friends who played this". Only Vanity's server hands them out (`server/src/roles.ts`); for now that is SBCVanity.
- New: **Vibe Check has a second row:** three picks from games you own but haven't installed, each with an Install button. If everything you own is installed, the row isn't there.
- Changed: **player counts are always on the covers** in the Library, in the bottom-left corner (before, only when the mouse was over a game). Games from other launchers get a count too once Vanity has found their Steam page, the same number their game page shows.
- Changed: **Settings is four short pages** (Appearance, Library, Playing, Updates) instead of one long one. It reopens on the page you used last, and Updates shows a dot when one is waiting.
- Fixed: the Steam card kept saying "(counting…)" after the achievement count had stopped growing. It now only says so while the number is still going up: games Steam can't report on no longer hold it up, and neither does running out of the day's Steam requests.
- Fixed: in the **Epic and GOG sign-in windows, "more sign-in options"** (Google, Apple, Xbox, Steam, Facebook…) did nothing, because Vanity blocked the small window they open. Those windows now open, and the sign-in window introduces itself as an ordinary browser so those services accept it.

## 0.14.0 (2026-11-14)
- New: **install Epic and GOG games inside Vanity** (stage 5 of the accounts and cloud update). Windows only.
  - **Downloads page** (in the sidebar, with a count): a queue that installs one game at a time, with a progress bar, speed, time left, and pause, resume and cancel. The queue is remembered when you close Vanity, and downloads carry on where they stopped.
  - **Install window:** choose the folder (Vanity remembers it), see the download size, installed size and free space, and get a clear message if the drive doesn't have room.
  - **Epic Games:** sign in under Account → Linked accounts. Your Epic library appears in Vanity, and Install downloads the game with Legendary, the open-source Epic client that now ships with Vanity. Games installed this way start from Vanity without the Epic launcher.
  - **GOG:** sign in under Linked accounts. Your GOG library appears, and Install downloads the game's installer and runs it without its windows (Windows asks once for permission).
  - **Steam** games still install through Steam; Vanity says so.
  - When an install finishes, the game moves to Installed by itself.
  - Clear messages for no internet, an expired store sign-in, a failed download or a full drive, with a Try again button. A Log button opens the downloader's log if something needs looking into.
- Epic and GOG sign-ins happen on the store's own page in a window, and stay on this PC. Vanity never sees those passwords. The GOG sign-in is kept encrypted with Windows credential protection.
- Linked accounts now shows without a Vanity account too (Epic and GOG don't need one; Steam does).

## 0.13.0 (2026-11-14)
- New: **your library now shows games you own but haven't installed** (stage 4 of the accounts and cloud update). With a Steam account linked, every game in your Steam library appears.
  - Games that aren't installed are greyed out, marked "Not installed", and have an **Install** button instead of Play.
  - New filter at the top of the Library: **All / Installed / Not installed**, with a count on each.
  - Install hands the game to Steam (Steam games install through Steam; Vanity says so). When Steam finishes, the game moves to Installed by itself and Vanity tells you.
  - Uninstall a Steam game you still own and it goes back to "Not installed", keeping its playtime, instead of showing as "Not found".
  - They use Steam's own cover art straight away. You can favourite them and put them in collections.
  - If you have the same game installed from another launcher, you see that one copy, not two.
  - Unlink Steam and they leave the library again. Removing one by hand keeps it away.
- Play, Surprise me, Vibe Check, Big Picture and the game count in the sidebar still only use games you can start right now.
- On Android the library stays as it is: PC games can't be installed on a phone.

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
