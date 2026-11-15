import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { applyFont, applyTheme, applyUi } from './lib/theme'
import { sanitizeUi } from '@shared/ui'
import { AmbientBackground } from './components/AmbientBackground'
import { useSettings } from './state/settings'
import { CandidateReview } from './components/CandidateReview'
import { LauncherStatusBar } from './components/LauncherStatusBar'
import { MusicPlayer } from './components/MusicPlayer'
import { UpdateBanner, UpdateButton } from './components/UpdateButton'
import { CommandPalette } from './components/CommandPalette'
import { SessionRecap } from './components/SessionRecap'
import { VibeCheck } from './components/VibeCheck'
import { GamepadLayer } from './gamepad/GamepadLayer'
import { Sidebar } from './components/Sidebar'
import { BottomNav } from './components/BottomNav'
import { AppPicker } from './components/AppPicker'
import { GameDetailPage } from './pages/GameDetailPage'
import { CollectionPage, LibraryPage } from './pages/LibraryPage'
import { SettingsPage } from './pages/SettingsPage'
import { TrendingPage } from './pages/TrendingPage'
import { SteamStorePage } from './pages/SteamStorePage'
import { StatsPage } from './pages/StatsPage'
import { WrappedPage } from './pages/WrappedPage'
import { BigPicturePage } from './pages/BigPicturePage'
import { FriendsPage } from './pages/FriendsPage'
import { AccountPage } from './pages/AccountPage'
import { ProfilePage } from './pages/ProfilePage'
import { DownloadsPage } from './pages/DownloadsPage'
import { InstallDialog } from './components/InstallDialog'
import { useProgress } from './state/progress'
import { reloadCollections } from './state/collections'
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
    applyUi(settings.ui, settings.theme)
  }, [settings?.theme, settings?.font, settings?.ui]) // eslint-disable-line react-hooks/exhaustive-deps
  // Launcher options from Settings → Customize.
  const ui = sanitizeUi(settings?.ui)

  // Cloud sync brought something in from another device: show it.
  const appliedAt = useProgress()?.sync.appliedAt ?? 0
  useEffect(() => {
    if (!appliedAt) return
    void refresh()
    void reloadCollections().catch(() => {})
  }, [appliedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phones: the sidebar is a slide-out menu, closed again whenever you go somewhere.
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div className="relative flex h-full">
      {settings?.ambientBackground !== false && <AmbientBackground kind={ui.background} />}
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <main className="relative z-10 min-w-0 flex-1 max-md:pb-[calc(3.5rem+env(safe-area-inset-bottom))] max-md:pt-[env(safe-area-inset-top)]">
        {/* Draggable strip under the native title-bar buttons (the window is frameless), with launcher status. */}
        <div className="absolute inset-x-0 top-0 z-20 flex h-9 items-center bg-gradient-to-b from-bg via-bg/85 to-transparent pl-10 pr-[150px] max-md:top-[env(safe-area-inset-top)] max-md:px-3 [-webkit-app-region:drag]">
          {ui.showLauncherStatus && (
            <div className="max-md:hidden">
              <LauncherStatusBar />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {ui.showMusicPlayer && <MusicPlayer />}
            <UpdateButton />
          </div>
        </div>
        <div key={location.pathname} className="h-full animate-[page-in_220ms_ease-out]">
          <Routes>
            <Route path="/library" element={<LibraryPage view="all" />} />
            <Route path="/trending" element={<TrendingPage />} />
            <Route path="/store" element={<SteamStorePage />} />
            <Route path="/recent" element={<LibraryPage view="recent" />} />
            <Route path="/favorites" element={<LibraryPage view="favorites" />} />
            <Route path="/collection/:id" element={<CollectionPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/wrapped" element={<WrappedPage />} />
            <Route path="/big" element={<BigPicturePage />} />
            <Route path="/friends" element={<FriendsPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/downloads" element={<DownloadsPage />} />
            <Route path="/game/:id" element={<GameDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {/* The page Vanity opens on is your choice; wait for settings so it isn't the Library by mistake. */}
            <Route path="*" element={settings ? <Navigate to={`/${ui.startPage}`} replace /> : null} />
          </Routes>
        </div>
      </main>
      <BottomNav onMenu={() => setMenuOpen(true)} />
      <AppPicker />
      <GamepadLayer />
      <UpdateBanner />
      <CommandPalette />
      <InstallDialog />
      <SessionRecap />
      <VibeCheck />
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
