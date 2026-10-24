import type { Game, GameCandidate, GamePatch, ScanProgress, ScanSummary, SessionChange, SessionState, Settings } from './types'

/** The API the preload script exposes to the renderer as `window.vanity`. */
export interface VanityApi {
  games: {
    list(): Promise<Game[]>
    get(id: number): Promise<Game | null>
    update(id: number, patch: GamePatch): Promise<Game | null>
    /** Removes a game from the library. A launcher game comes back on the next scan if it is still installed. */
    remove(id: number): Promise<void>
    /** Opens the game's install folder in Explorer. Resolves to an error message, or null on success. */
    openFolder(id: number): Promise<string | null>
    /** Starts the game. Resolves to an error message, or null on success. */
    launch(id: number): Promise<string | null>
    /** Opens a file picker to choose the game's exe. Resolves to the updated game, or null if cancelled. */
    pickExecutable(id: number): Promise<Game | null>
    /** Adds the confirmed custom-folder candidates and ignores the rest. */
    confirmCandidates(accepted: GameCandidate[], rejected: GameCandidate[]): Promise<Game[]>
    /** Opens a file picker for an .exe. Resolves to null if cancelled. */
    addManually(): Promise<Game | null>
  }
  sessions: {
    /** Games currently launching or running, by game ID. */
    states(): Promise<Record<number, Exclude<SessionState, 'stopped'>>>
    onChange(callback: (change: SessionChange) => void): () => void
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
  gamesOpenFolder: 'games:open-folder',
  gamesLaunch: 'games:launch',
  gamesPickExecutable: 'games:pick-executable',
  sessionsStates: 'sessions:states',
  sessionsChanged: 'sessions:changed',
  gamesConfirmCandidates: 'games:confirm-candidates',
  gamesAddManually: 'games:add-manually',
  scanStart: 'scan:start',
  scanProgress: 'scan:progress',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsPickFolder: 'settings:pick-folder'
} as const
