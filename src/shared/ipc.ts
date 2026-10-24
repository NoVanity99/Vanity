import type { Game, GameCandidate, GamePatch, ScanProgress, ScanSummary, Settings } from './types'

/** The API the preload script exposes to the renderer as `window.vanity`. */
export interface VanityApi {
  games: {
    list(): Promise<Game[]>
    get(id: number): Promise<Game | null>
    update(id: number, patch: GamePatch): Promise<Game | null>
    /** Removes a game from the library. A launcher game comes back on the next scan if it is still installed. */
    remove(id: number): Promise<void>
    /** Adds the confirmed custom-folder candidates and ignores the rest. */
    confirmCandidates(accepted: GameCandidate[], rejected: GameCandidate[]): Promise<Game[]>
    /** Opens a file picker for an .exe. Resolves to null if cancelled. */
    addManually(): Promise<Game | null>
  }
  scan: {
    start(): Promise<ScanSummary>
    onProgress(callback: (progress: ScanProgress[]) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
    /** Opens a folder picker. Resolves to null if cancelled. */
    pickFolder(): Promise<string | null>
  }
}

/** IPC channel names, shared by the main process and preload. */
export const IPC = {
  gamesList: 'games:list',
  gamesGet: 'games:get',
  gamesUpdate: 'games:update',
  gamesRemove: 'games:remove',
  gamesConfirmCandidates: 'games:confirm-candidates',
  gamesAddManually: 'games:add-manually',
  scanStart: 'scan:start',
  scanProgress: 'scan:progress',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsPickFolder: 'settings:pick-folder'
} as const
