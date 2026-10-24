import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { CandidateReview } from './components/CandidateReview'
import { Sidebar } from './components/Sidebar'
import { GameDetailPage } from './pages/GameDetailPage'
import { LibraryPage } from './pages/LibraryPage'
import { SettingsPage } from './pages/SettingsPage'
import { LibraryProvider, useLibrary } from './state/library'
import { ToastProvider, useToast } from './state/toasts'

function Shell(): React.JSX.Element {
  const { candidates, clearCandidates, refresh } = useLibrary()
  const location = useLocation()
  const toast = useToast()

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative min-w-0 flex-1">
        {/* Draggable strip under the native title-bar buttons (the window is frameless). */}
        <div className="absolute inset-x-0 top-0 z-20 h-9 [-webkit-app-region:drag]" />
        <div key={location.pathname} className="h-full animate-[page-in_220ms_ease-out]">
          <Routes>
            <Route path="/library" element={<LibraryPage view="all" />} />
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
