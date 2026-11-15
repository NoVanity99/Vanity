import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { START_PAGES } from '@shared/interfaceOptions'
import { applyFont, applyTheme } from './lib/theme'
import { AmbientBackground } from './components/AmbientBackground'
import { useInterface, useSettings } from './state/settings'
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
import { FriendProfilePage } from './pages/FriendProfilePage'
import { AccountPage } from './pages/AccountPage'
import { ProfilePage } from './pages/ProfilePage'
import { DownloadsPage } from './pages/DownloadsPage'
import { InstallDialog } from './components/InstallDialog'
import { useProgress } from './state/progress'
import { reloadCollections } from './state/collections'
import { LibraryProvider, useLibrary } from './state/library'
import { ToastProvider, useToast } from './state/toasts'

/** The time, in the top bar (Settings → Customize). */
function Clock({ hour12 }: { hour12: boolean }): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(timer)
  }, [])
  return (
    <time data-clock className="rounded-full border border-white/10 bg-black/30 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-text/85 backdrop-blur" dateTime={now.toISOString()}>
      {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12 })}
    </time>
  )
}

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

  // Customize: interface size, corner style, animations and cover effects are plain attributes on
  // the page that the stylesheet reacts to (styles/index.css).
  const ui = useInterface()
  useEffect(() => {
    const root = document.documentElement
    root.dataset.scale = ui.scale
    root.dataset.corners = ui.corners
    root.dataset.coverHover = ui.coverHover
    root.dataset.statusBadges = String(ui.statusBadges)
    root.dataset.gameNames = String(ui.gameNames)
    if (ui.animations) delete root.dataset.motion
    else root.dataset.motion = 'reduced'
  }, [ui.scale, ui.corners, ui.coverHover, ui.statusBadges, ui.gameNames, ui.animations])
  const startPath = START_PAGES.find((p) => p.id === ui.startPage)?.path ?? '/library'

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
      {settings?.ambientBackground !== false && <AmbientBackground />}
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <main className="relative z-10 min-w-0 flex-1 max-md:pb-[calc(3.5rem+env(safe-area-inset-bottom))] max-md:pt-[env(safe-area-inset-top)]">
        {/* Draggable strip under the native title-bar buttons (the window is frameless), with launcher status. */}
        <div className="absolute inset-x-0 top-0 z-20 flex h-9 items-center bg-gradient-to-b from-bg via-bg/85 to-transparent pl-10 pr-[150px] max-md:top-[env(safe-area-inset-top)] max-md:px-3 [-webkit-app-region:drag]">
          {ui.launcherStatus && (
            <div className="max-md:hidden">
              <LauncherStatusBar />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {ui.clock !== 'off' && <Clock hour12={ui.clock === '12'} />}
            {ui.musicPlayer && <MusicPlayer />}
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
            <Route path="/friends/:id" element={<FriendProfilePage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/downloads" element={<DownloadsPage />} />
            <Route path="/game/:id" element={<GameDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {/* Vanity opens on the page chosen in Settings → Customize (once the settings are read). */}
            <Route path="*" element={settings ? <Navigate to={startPath} replace /> : null} />
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
