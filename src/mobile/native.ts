import { registerPlugin } from '@capacitor/core'

export interface NativeApp {
  packageName: string
  name: string
  /** Android marks it as a game (its category, or the older "is game" flag). */
  isGame: boolean
  /** When it was installed (ms). */
  installedAt: number
  /** file:// path of its icon, saved by the app, or null. */
  icon: string | null
}

export interface NativeTrack {
  /** content:// address of the song. */
  uri: string
  title: string
  artist: string | null
  album: string | null
  /** content:// address of the album art, or null. */
  art: string | null
}

/** The native (Java) side of Vanity on Android: android/app/src/main/java/.../VanityNativePlugin.java */
export interface VanityNative {
  /** Every app with a launcher icon, except Vanity itself. */
  listApps(): Promise<{ apps: NativeApp[] }>
  launch(opts: { packageName: string }): Promise<void>
  /** Whether Vanity may read app usage (for playtime). */
  usageAccess(): Promise<{ granted: boolean }>
  /** Opens Android's "Usage access" settings page. */
  openUsageSettings(): Promise<void>
  /** Times each of the given apps was on screen since `since` (ms). */
  usage(opts: { since: number; packages: string[] }): Promise<{ sessions: { packageName: string; start: number; end: number }[] }>
  /** Songs on the phone. Asks for permission if needed; `granted` is false if the user said no. */
  listMusic(): Promise<{ granted: boolean; tracks: NativeTrack[] }>
  /**
   * Downloads the newest Vanity APK inside the app and opens Android's install screen.
   * Sends "updateProgress" events ({ percent }) while it downloads.
   */
  installUpdate?(opts: { url: string }): Promise<void>
  addListener?(event: 'updateProgress', cb: (data: { percent: number }) => void): Promise<{ remove(): Promise<void> }> | { remove(): Promise<void> }
  /** Opens a web address (or a file download) outside Vanity. */
  openUrl(opts: { url: string }): Promise<void>
}

declare global {
  interface Window {
    /** Tests run the Android build in a desktop browser with a stand-in for the native side. */
    __vanityNativeMock?: VanityNative
  }
}

export const native: VanityNative = window.__vanityNativeMock ?? registerPlugin<VanityNative>('VanityNative')
