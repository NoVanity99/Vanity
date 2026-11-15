import { installsInVanity, openInstallDialog } from './downloads'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Game, GameCandidate, GamePatch, MetadataProgress, ScanProgress, ScanSummary, SessionState } from '@shared/types'
import { dedupeByName } from '@shared/dedupe'
import { useToast } from './toasts'

interface LibraryState {
  /** Your library, one entry per game name (the same game found twice is shown once). */
  /** The games you can play here: installed on this device, one entry per name. */
  games: Game[]
  /** Everything in the library, one entry per name: installed games plus ones you own but haven't installed. */
  library: Game[]
  /** Every stored game, including duplicate copies that aren't shown. For looking a game up by ID. */
  allGames: Game[]
  loading: boolean
  refresh(): Promise<Game[]>
  updateGame(id: number, patch: GamePatch): Promise<void>
  removeGame(id: number): Promise<void>
  addManually(): Promise<void>
  openFolder(id: number): Promise<void>
  /** Launch state per game ID; absent means not running. */
  sessions: Record<number, Exclude<SessionState, 'stopped'>>
  launch(id: number): Promise<void>
  /** Installs a game you own but haven't installed (Steam games install through Steam). */
  install(id: number): Promise<void>
  /** Cancels a game that is starting, or force-closes one that is running. */
  stop(id: number): Promise<void>
  pickExecutable(id: number): Promise<void>
  scan: {
    running: boolean
    progress: ScanProgress[]
    last: ScanSummary | null
    /** Rescans the launchers. Resolves to what was found, or null if the scan failed (it says so itself). */
    start(): Promise<ScanSummary | null>
  }
  metadata: MetadataProgress
  /** Replaces a game in the list (after a dialog changed it). */
  replaceGame(game: Game): void
  /** Custom-folder finds waiting for review; the app shows the review dialog while non-empty. */
  candidates: GameCandidate[]
  clearCandidates(): void
}

const LibraryContext = createContext<LibraryState | null>(null)

export function useLibrary(): LibraryState {
  const ctx = useContext(LibraryContext)
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider')
  return ctx
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function LibraryProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const toast = useToast()
  const [allGames, setGames] = useState<Game[]>([])
  const library = useMemo(() => dedupeByName(allGames), [allGames])
  // Play, Surprise me, Vibe Check, Big Picture and the counts are about games you can start right now.
  const games = useMemo(() => library.filter((g) => g.installed), [library])
  const allGamesRef = useRef<Game[]>([])
  allGamesRef.current = allGames
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress[]>([])
  const [last, setLast] = useState<ScanSummary | null>(null)
  const [candidates, setCandidates] = useState<GameCandidate[]>([])
  const autoScanned = useRef(false)
  const [sessions, setSessions] = useState<LibraryState['sessions']>({})
  const [metadata, setMetadata] = useState<MetadataProgress>({ running: false, done: 0, total: 0 })
  const replaceGame = useCallback((game: Game) => setGames((gs) => gs.map((g) => (g.id === game.id ? game : g))), [])

  const reloadGame = useCallback(async (id: number) => {
    const game = await window.vanity.games.get(id).catch(() => null)
    if (game) setGames((gs) => gs.map((g) => (g.id === id ? game : g)))
  }, [])

  // Artwork and details arrive in the background; pick them up as each game finishes.
  useEffect(() => {
    window.vanity.metadata.progress().then(setMetadata, () => {})
    const offProgress = window.vanity.metadata.onProgress(setMetadata)
    const offGame = window.vanity.metadata.onGameUpdated((id) => reloadGame(id))
    return () => {
      offProgress()
      offGame()
    }
  }, [reloadGame])

  useEffect(() => {
    window.vanity.sessions.states().then(setSessions, () => {})
    return window.vanity.sessions.onChange(({ gameId, state }) => {
      setSessions((prev) => {
        const next = { ...prev }
        if (state === 'stopped') delete next[gameId]
        else next[gameId] = state
        return next
      })
      // Last played and playtime change with each session event.
      reloadGame(gameId)
    })
  }, [reloadGame])

  const refresh = useCallback(async () => {
    try {
      const list = await window.vanity.games.list()
      setGames(list)
      return list
    } catch (err) {
      toast(`Could not load your library: ${message(err)}`, 'error')
      return []
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => window.vanity.scan.onProgress(setProgress), [])

  const start = useCallback(async () => {
    setRunning(true)
    try {
      const summary = await window.vanity.scan.start()
      setProgress(summary.progress)
      setLast(summary)
      setCandidates(summary.candidates)
      await refresh()
      const failed = summary.progress.filter((p) => p.status === 'error').length
      if (failed) toast(`${failed} source${failed > 1 ? 's' : ''} could not be scanned. See Settings for details.`, 'error')
      else if (summary.added) toast(`Found ${summary.added} new game${summary.added > 1 ? 's' : ''}`)
      return summary
    } catch (err) {
      toast(`Scan failed: ${message(err)}`, 'error')
      return null
    } finally {
      setRunning(false)
    }
  }, [refresh, toast])

  // Load the library, then look for new games: every time Vanity opens.
  useEffect(() => {
    refresh().then(() => {
      if (autoScanned.current) return
      autoScanned.current = true
      start()
    })
  }, [refresh, start])

  const updateGame = useCallback(
    async (id: number, patch: GamePatch) => {
      try {
        const updated = await window.vanity.games.update(id, patch)
        if (updated) setGames((gs) => gs.map((g) => (g.id === id ? updated : g)))
      } catch (err) {
        toast(`Could not save the change: ${message(err)}`, 'error')
      }
    },
    [toast]
  )

  const removeGame = useCallback(
    async (id: number) => {
      try {
        await window.vanity.games.remove(id)
        setGames((gs) => gs.filter((g) => g.id !== id))
      } catch (err) {
        toast(`Could not remove the game: ${message(err)}`, 'error')
      }
    },
    [toast]
  )

  const addManually = useCallback(async () => {
    try {
      const game = await window.vanity.games.addManually()
      if (game) {
        await refresh()
        toast(`Added ${game.name}`)
      }
    } catch (err) {
      toast(`Could not add the game: ${message(err)}`, 'error')
    }
  }, [refresh, toast])

  const openFolder = useCallback(
    async (id: number) => {
      const error = await window.vanity.games.openFolder(id).catch(message)
      if (error) toast(error, 'error')
    },
    [toast]
  )

  // Owned games arrive from linked accounts, and installs finish, in the background.
  useEffect(() => {
    const offChanged = window.vanity.games.onChanged(() => void refresh())
    const offInstalled = window.vanity.games.onInstalled((game) => toast(`${game.name} is installed and ready to play`))
    return () => {
      offChanged()
      offInstalled()
    }
  }, [refresh, toast])

  // Playtime is saved while a game runs; refresh it so the numbers tick up.
  const runningIds = Object.entries(sessions)
    .filter(([, state]) => state === 'running')
    .map(([id]) => Number(id))
    .join(',')
  useEffect(() => {
    if (!runningIds) return
    const timer = setInterval(() => runningIds.split(',').forEach((id) => reloadGame(Number(id))), 15_000)
    return () => clearInterval(timer)
  }, [runningIds, reloadGame])

  const install = useCallback(
    async (id: number) => {
      const game = allGamesRef.current.find((g) => g.id === id)
      if (game && installsInVanity(game)) return openInstallDialog(game)
      const res = await window.vanity.games.install(id).catch((err) => ({ error: message(err), data: undefined }))
      if (res.error !== undefined) toast(res.error, 'error')
      else toast(res.data.note)
    },
    [toast]
  )

  /** Cancels a game that is starting, or force-closes one that is running. */
  const stop = useCallback(
    async (id: number) => {
      const res = await window.vanity.sessions.stop(id).catch((err) => ({ error: message(err), data: undefined }))
      if (res.error !== undefined) return toast(res.error, 'error')
      setSessions((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      const { wasRunning, closed } = res.data
      if (!wasRunning) toast(closed ? 'Cancelled, and closed the game' : 'Cancelled')
      else toast(closed ? 'Game closed' : "Vanity stopped tracking it, but couldn't find the game's process to close", closed ? undefined : 'error')
      void reloadGame(id)
    },
    [toast, reloadGame]
  )

  const launch = useCallback(
    async (id: number) => {
      setSessions((prev) => ({ ...prev, [id]: prev[id] ?? 'launching' }))
      const error = await window.vanity.games.launch(id).catch(message)
      if (error) {
        toast(error, 'error')
        setSessions((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    },
    [toast]
  )

  const pickExecutable = useCallback(
    async (id: number) => {
      try {
        const updated = await window.vanity.games.pickExecutable(id)
        if (updated) setGames((gs) => gs.map((g) => (g.id === id ? updated : g)))
      } catch (err) {
        toast(`Could not change the program: ${message(err)}`, 'error')
      }
    },
    [toast]
  )

  const value = useMemo<LibraryState>(
    () => ({
      games,
      library,
      allGames,
      loading,
      refresh,
      updateGame,
      removeGame,
      addManually,
      openFolder,
      sessions,
      launch,
      install,
      stop,
      pickExecutable,
      scan: { running, progress, last, start },
      metadata,
      replaceGame,
      candidates,
      clearCandidates: () => setCandidates([])
    }),
    [
      games,
      library,
      allGames,
      loading,
      refresh,
      updateGame,
      removeGame,
      addManually,
      openFolder,
      sessions,
      launch,
      install,
      stop,
      pickExecutable,
      running,
      progress,
      last,
      start,
      metadata,
      replaceGame,
      candidates
    ]
  )

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}
