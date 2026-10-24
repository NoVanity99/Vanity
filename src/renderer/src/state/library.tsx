import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Game, GameCandidate, GamePatch, ScanProgress, ScanSummary, SessionState } from '@shared/types'
import { useToast } from './toasts'

interface LibraryState {
  games: Game[]
  loading: boolean
  refresh(): Promise<Game[]>
  updateGame(id: number, patch: GamePatch): Promise<void>
  removeGame(id: number): Promise<void>
  addManually(): Promise<void>
  openFolder(id: number): Promise<void>
  /** Launch state per game ID; absent means not running. */
  sessions: Record<number, Exclude<SessionState, 'stopped'>>
  launch(id: number): Promise<void>
  pickExecutable(id: number): Promise<void>
  scan: {
    running: boolean
    progress: ScanProgress[]
    last: ScanSummary | null
    start(): Promise<void>
  }
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
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress[]>([])
  const [last, setLast] = useState<ScanSummary | null>(null)
  const [candidates, setCandidates] = useState<GameCandidate[]>([])
  const autoScanned = useRef(false)
  const [sessions, setSessions] = useState<LibraryState['sessions']>({})

  const reloadGame = useCallback(async (id: number) => {
    const game = await window.vanity.games.get(id).catch(() => null)
    if (game) setGames((gs) => gs.map((g) => (g.id === id ? game : g)))
  }, [])

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
    } catch (err) {
      toast(`Scan failed: ${message(err)}`, 'error')
    } finally {
      setRunning(false)
    }
  }, [refresh, toast])

  // Load the library; on a first run (empty library) scan straight away.
  useEffect(() => {
    refresh().then((list) => {
      if (list.length === 0 && !autoScanned.current) {
        autoScanned.current = true
        start()
      }
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
      loading,
      refresh,
      updateGame,
      removeGame,
      addManually,
      openFolder,
      sessions,
      launch,
      pickExecutable,
      scan: { running, progress, last, start },
      candidates,
      clearCandidates: () => setCandidates([])
    }),
    [games, loading, refresh, updateGame, removeGame, addManually, openFolder, sessions, launch, pickExecutable, running, progress, last, start, candidates]
  )

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}
