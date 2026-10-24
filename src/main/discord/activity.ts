/** What Vanity is doing, for Discord. */
export interface PresenceInput {
  game: { name: string; startedAt: number; imageUrl: string | null } | null
  music: { title: string; artist: string | null; startedAt: number; durationMs: number | null } | null
}

/** The activity object Discord's SET_ACTIVITY takes. */
export interface Activity {
  type?: number
  details?: string
  state?: string
  timestamps?: { start?: number; end?: number }
  assets?: { large_image?: string; large_text?: string; small_image?: string; small_text?: string }
  instance?: boolean
}

/** Rich-presence image key: upload an image named "vanity" under your Discord app's Rich Presence → Art Assets. */
export const LOGO = 'vanity'
const PLAYING = 0
const LISTENING = 2

/** Discord rejects fields shorter than 2 or longer than 128 characters. */
export function fit(s: string): string {
  const t = s.trim()
  if (t.length > 128) return `${t.slice(0, 127)}…`
  return t.length < 2 ? `${t}  ` : t
}

function song(m: NonNullable<PresenceInput['music']>): string {
  return m.artist ? `${m.title} · ${m.artist}` : m.title
}

/**
 * Builds the presence, shown under "Vanity" in Discord:
 * - playing a game: "Playing <game>" with an elapsed timer;
 * - music only: "Listening to <song>" with the song's elapsed time (and a progress bar when its length is known);
 * - both: the game on top, "Listening to <song>" under it, with the game's timer.
 * Returns null when there's nothing to show (Discord then clears it).
 */
export function buildActivity({ game, music }: PresenceInput): Activity | null {
  if (game) {
    return {
      type: PLAYING,
      details: fit(`Playing ${game.name}`),
      ...(music ? { state: fit(`Listening to ${song(music)}`) } : {}),
      timestamps: { start: game.startedAt },
      assets: {
        large_image: game.imageUrl ?? LOGO,
        large_text: fit(game.name),
        ...(music ? { small_image: LOGO, small_text: fit(`Listening to ${song(music)}`) } : {})
      },
      instance: false
    }
  }
  if (music) {
    return {
      type: LISTENING,
      details: fit(`Listening to ${music.title}`),
      ...(music.artist ? { state: fit(`by ${music.artist}`) } : {}),
      timestamps: { start: music.startedAt, ...(music.durationMs ? { end: music.startedAt + music.durationMs } : {}) },
      assets: { large_image: LOGO, large_text: 'Vanity music player' },
      instance: false
    }
  }
  return null
}
