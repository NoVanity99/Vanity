import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { applyFont, applyTheme } from './lib/theme'
import { AmbientBackground } from './components/AmbientBackground'
import { useSettings } from './state/settings'
import { CandidateReview } from './components/CandidateReview'
import { LauncherStatusBar } from './components/LauncherStatusBar'
import { MusicPlayer } from './components/MusicPlayer'
import { Sidebar } from './components/Sidebar'
import { GameDetailPage } from './pages/GameDetailPage'
import { LibraryPage } from './pages/LibraryPage'
import { SettingsPage } from './pages/SettingsPage'
import { TrendingPage } from './pages/TrendingPage'
import { LibraryProvider, useLibrary } from './state/library'
import { ToastProvider, useToast } from './state/toasts'

function Shell(): React.JSX.Element {
  const { candidates, clearCandidates, refresh } = useLibrary()
  const location = useLocation()
  const toast = useToast()

  const settings = useSettings()
  useEffect(() => {
    if (!settings) return
    applyTheme(settings.theme)
    applyFont(settings.font)
  }, [settings?.theme, settings?.font]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative flex h-full">
      {settings?.ambientBackground !== false && <AmbientBackground />}
      <Sidebar />
      <main className="relative z-10 min-w-0 flex-1">
        {/* Draggable strip under the native title-bar buttons (the window is frameless), with launcher status. */}
        <div className="absolute inset-x-0 top-0 z-20 flex h-9 items-center bg-gradient-to-b from-bg via-bg/85 to-transparent pl-10 pr-[150px] [-webkit-app-region:drag]">
          <LauncherStatusBar />
          <div className="ml-auto">
            <MusicPlayer />
          </div>
        </div>
        <div key={location.pathname} className="h-full animate-[page-in_220ms_ease-out]">
          <Routes>
            <Route path="/library" element={<LibraryPage view="all" />} />
            <Route path="/trending" element={<TrendingPage />} />
            <Route path="/recent" element={<LibraryPage view="recent" />} />
            <Route path="/favorites" element={<LibraryPage view="favorites" />} />
            <Route path="/game/:id" element={<GameDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/library" replace />} />
          </Routes>
        </div>
      </main>
      {candidates.length > 0 && (
        <CandidateReview
          candidates={candidates}
          onDone={(added) => {
            clearCandidates()
            refresh()
            if (added) toast(`Added ${added} game${added > 1 ? 's' : ''} to your library`)
          }}
        />
      )}
    </div>
  )
}

export function App(): React.JSX.Element {
  return (
    <HashRouter>
      <ToastProvider>
        <LibraryProvider>
          <Shell />
        </LibraryProvider>
      </ToastProvider>
    </HashRouter>
  )
}
