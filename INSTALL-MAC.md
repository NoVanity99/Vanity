# Installing Vanity on a Mac

Vanity runs natively on every Mac with macOS 12 (Monterey) or newer, on both Apple Silicon (M1 and
later) and Intel, with no Rosetta needed.

## Install

1. Download **Vanity-&lt;version&gt;-universal.dmg** from the [newest release](https://github.com/NoVanity99/Vanity/releases/latest).
2. Open it, and drag **Vanity** onto the **Applications** folder.
3. Eject the Vanity disk (the ⏏ button next to it in Finder).

## Opening it the first time

This copy of Vanity isn't signed with a paid Apple Developer ID, so the first time you open it macOS
says it "can't be opened because Apple cannot check it for malicious software" (or that it's from an
unidentified developer). You only have to get past this once:

- **The quick way:** in **Applications**, **right-click** (or Control-click) **Vanity** and choose
  **Open**, then **Open** again in the box that appears.
- **If there's no Open button** (macOS 15 Sequoia and newer): try to open Vanity once and close the
  message. Then go to **System Settings → Privacy & Security**, scroll down to the line about
  Vanity, and click **Open Anyway**. Confirm with your password or Touch ID.

After that it opens like any other app.

If macOS ever says Vanity "is damaged and can't be opened", the download was quarantined in a way the
steps above don't clear. In Terminal, run:

```bash
xattr -dr com.apple.quarantine /Applications/Vanity.app
```

## Permissions macOS asks for

- **Microphone** and **Camera:** only when you join a voice room or turn on video.
- **Screen Recording:** only when you share your screen in a voice room.
- **Accessibility / Input Monitoring:** only if you set a push-to-talk key, so the key works while
  you're in a game.

You can change any of these later in **System Settings → Privacy & Security**.

## Where Vanity keeps things

| What | Where |
| --- | --- |
| Your library, settings and sign-in | `~/Library/Application Support/Vanity` |
| Downloaded artwork and converted music | `~/Library/Caches/Vanity` (safe to delete; it comes back) |
| Logs | `~/Library/Logs/Vanity` |

To remove Vanity completely, drag it from Applications to the Bin and delete those three folders.

## Updates

Without an Apple Developer ID, macOS doesn't let an app replace itself, so Vanity tells you when a new
version is out and its **Download** button opens the release page. Open the new .dmg and drag Vanity
onto Applications again, choosing **Replace**. Your library and settings are kept. (A Developer ID
signed build updates itself, like on Windows. See RELEASING.md.)

## What's different from Windows

- **Games it finds:** Steam, the Epic Games Launcher, GOG (games installed as apps), and games in
  your Applications folders. EA and Ubisoft are Windows-only, so they aren't scanned.
- **Installing games:** Epic and GOG games install through their own launchers on a Mac (Vanity's
  own Downloads tab installs the Windows versions, so it's hidden). Steam's Install button works as
  on Windows.
- **Windows games** (an .exe you added on Windows) show as **Windows only** and can't be started.
- **Not on Mac (yet):** the in-game overlay, and sharing your computer's sound along with your screen.
- **Closing the window** leaves Vanity running in the Dock, as Mac apps do. Click its Dock icon to
  bring it back, and quit with **⌘Q**.
