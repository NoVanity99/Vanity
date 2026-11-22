import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { START_PAGES } from '@shared/interfaceOptions'
import { applyFont, applyTheme } from './lib/theme'
import { AmbientBackground } from './components/AmbientBackground'
import { PanelLeftOpen } from 'lucide-react'
import { saveSettings, useInterface, useSettings } from './state/settings'
import { CandidateReview } from './components/CandidateReview'
import { LauncherStatusBar } from './components/LauncherStatusBar'
import { MusicPlayer } from './components/MusicPlayer'
import { UpdateBanner, UpdateButton } from './components/UpdateButton'
import { CommandPalette } from './components/CommandPalette'
import { SessionRecap } from './components/SessionRecap'
import { VibeCheck } from './components/VibeCheck'
import { FriendNotifications } from './components/FriendNotifications'
import { ChatDock } from './components/ChatDock'
import { useAccount } from './state/account'
import { AuthGate, useGate } from './components/auth/AuthGate'
import { usePulse, usePulseRefresh } from './state/pulse'
import { CoinsPage, PurchasesPage } from './pages/CoinsPage'
import { CallLayer } from './components/voice/CallLayer'
import { Coins } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useFriendsRefresh } from './state/friends'
import { useGroupsRefresh } from './state/groups'
import { useCommunitiesRefresh } from './state/communities'
import { ChannelsPage } from './pages/ChannelsPage'
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
import { VoicePage } from './pages/VoicePage'
import { VoiceBar } from './components/voice/VoiceBar'
import { cn } from './lib/cn'
import { syncVoiceSettings, wireOverlay, wirePushToTalk } from './state/voice'
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
  // The voice engine follows the voice settings; push-to-talk is listened for once.
  useEffect(() => syncVoiceSettings(settings?.voice), [settings?.voice])
  useEffect(() => wirePushToTalk(), [])
  useEffect(() => (window.vanity.overlay.supported ? wireOverlay() : undefined), [])

  // Friends are kept fresh in the background for the sidebar's counts and for notifications.
  const account = useAccount()
  useFriendsRefresh(account?.username)
  useGroupsRefresh(account?.username)
  useCommunitiesRefresh(account?.username)
  // Signed out, or a new account still being set up: the launcher waits behind a pop-up.
  const gate = useGate(account)
  // The quick check-in: coins, calls ringing, a new name or badge, without a restart.
  usePulseRefresh(account)
  const coins = usePulse().coins
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
    <>
    {gate && account && <AuthGate account={account} gate={gate} />}
    {/* Nothing behind the pop-up can be clicked, tabbed to or reached with a controller. */}
    <div className="relative flex h-full" inert={gate ? true : undefined} data-gated={gate ? '' : undefined}>
      {settings?.ambientBackground !== false && <AmbientBackground />}
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <main className="relative z-10 min-w-0 flex-1 max-md:pb-[calc(3.5rem+env(safe-area-inset-bottom))] max-md:pt-[env(safe-area-inset-top)]">
        {/* Draggable strip under the native title-bar buttons (the window is frameless), with launcher status. */}
        <div className="absolute inset-x-0 top-0 z-20 flex h-9 items-center bg-gradient-to-b from-bg via-bg/85 to-transparent pl-10 pr-[150px] max-md:top-[env(safe-area-inset-top)] max-md:px-3 [-webkit-app-region:drag]">
          {/* Brings a hidden sidebar back. It lives inside this strip, and after it in the page, on purpose:
              the strip drags the window, and Windows only lets a button be clicked there if the button
              is declared after the draggable area it sits on. */}
          {ui.sidebarCollapsed && (
            <button
              onClick={() => void saveSettings({ interface: { ...ui, sidebarCollapsed: false } }).catch(() => {})}
              title="Show the sidebar"
              aria-label="Show the sidebar"
              data-sidebar-expand
              className="absolute left-2 top-1 flex size-7 items-center justify-center rounded-lg border border-white/10 bg-black/50 text-muted backdrop-blur transition hover:border-accent/60 hover:text-text max-md:hidden [-webkit-app-region:no-drag]"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          )}
          {ui.launcherStatusBar && (
            <div className="max-md:hidden">
              <LauncherStatusBar />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {coins !== null && (
              <Link to="/coins" title="Vanity Coins: get more" className="flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-black/30 px-2.5 py-0.5 text-xs font-bold tabular-nums text-amber-200 backdrop-blur transition hover:border-amber-300/70 [-webkit-app-region:no-drag]" data-coin-chip={coins}>
                <Coins className="size-3.5" /> {coins.toLocaleString()}
              </Link>
            )}
            {ui.clock !== 'off' && <Clock hour12={ui.clock === '12'} />}
            {ui.musicPlayer && <MusicPlayer />}
            <UpdateButton />
          </div>
        </div>
        {/* Moving around inside Channels keeps the page as it is (its own panes do the animating). */}
        <div key={location.pathname.startsWith('/channels') ? '/channels' : location.pathname} className="h-full animate-[page-in_220ms_ease-out]">
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
            <Route path="/channels" element={<ChannelsPage />} />
            <Route path="/channels/:communityId" element={<ChannelsPage />} />
            <Route path="/channels/:communityId/:channelId" element={<ChannelsPage />} />
            <Route path="/voice" element={<VoicePage />} />
            <Route path="/friends/:id" element={<FriendProfilePage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/account/purchases" element={<PurchasesPage />} />
            <Route path="/coins" element={<CoinsPage />} />
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
      {!gate && <CommandPalette />}
      <InstallDialog />
      <SessionRecap />
      <VibeCheck />
      <FriendNotifications />
      <CallLayer />
      <ChatDock />
      {/* The voice bar, when the sidebar isn't showing it: hidden sidebar, or a phone. */}
      <div className={cn('pointer-events-none fixed bottom-3 left-3 z-[44] max-md:bottom-[calc(4rem+env(safe-area-inset-bottom))]', !ui.sidebarCollapsed && 'md:hidden')}>
        <VoiceBar floating />
      </div>
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
    </>
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
