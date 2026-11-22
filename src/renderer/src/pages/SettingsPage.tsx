import { AdminPanel } from '@/components/settings/AdminPanel'
import { useAccount } from '@/state/account'
import { exeName, unblockExe } from '@shared/scanBlock'
import { useEffect, useState } from 'react'
import type { DiscordStatus } from '@shared/types'
import { ArrowDownToLine, AudioLines, Ban, ShieldAlert, CheckCircle2, Eye, EyeOff, FolderPlus, Gamepad, Gamepad2, KeyRound, Library, Palette, RefreshCw, SlidersHorizontal, Trash2, XCircle, type LucideIcon } from 'lucide-react'
import { THEMES } from '@shared/themes'
import { SCAN_SOURCES, SOURCE_LABELS, type KeyCheck, type Settings } from '@shared/types'
import { FONT_GROUPS, FONT_THEMES } from '@shared/fonts'
import { applyFont, applyTheme } from '@/lib/theme'
import { saveSettings, useSettings } from '@/state/settings'
import { Button } from '@/components/Dialog'
import { CustomizeSettings } from '@/components/settings/CustomizeSettings'
import { VoiceSettingsPanel } from '@/components/settings/VoiceSettingsPanel'
import { Section, Toggle } from '@/components/settings/controls'
import { ScanProgressPanel } from '@/components/ScanProgressPanel'
import { cn } from '@/lib/cn'
import { useLibrary } from '@/state/library'
import { useToast } from '@/state/toasts'
import { checkForUpdate, openUpdateDialog, pendingCount, useUpdate } from '@/state/update'
import { formatAgo } from '@/lib/format'
import { isAndroid } from '@/lib/platform'
import { loadPref, savePref } from '@/lib/storage'

/**
 * Shows the "Metadata & artwork" section with the API key fields.
 * Hidden: the API keys are built in (src/main/builtinKeys.ts). Set to true to show it again.
 */
const SHOW_API_KEYS = false

/** Settings are split into a few short pages instead of one long one. */
type SettingsTab = 'look' | 'customize' | 'voice' | 'library' | 'playing' | 'updates' | 'admin'
const SETTINGS_TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: 'look', label: 'Appearance', icon: Palette },
  { id: 'customize', label: 'Customize', icon: SlidersHorizontal },
  { id: 'voice', label: 'Voice', icon: AudioLines },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'playing', label: 'Playing', icon: Gamepad2 },
  { id: 'updates', label: 'Updates', icon: ArrowDownToLine },
  // Only shown to Vanity's admins (and the server checks the badge on everything it does).
  { id: 'admin', label: 'Admin', icon: ShieldAlert }
]

/** A credential field that saves when it loses focus or on Enter. */
function SecretField({ label, value, onSave, help }: { label: string; value: string; onSave: (v: string) => void; help?: React.ReactNode }): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [visible, setVisible] = useState(false)
  useEffect(() => setDraft(value), [value])
  const commit = (): void => {
    if (draft.trim() !== value) onSave(draft.trim())
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder="Not set"
          className="h-10 w-full rounded-lg border border-border bg-surface-2 px-3 pr-10 font-mono text-sm outline-none transition placeholder:font-sans placeholder:text-muted focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-text"
          aria-label={visible ? 'Hide' : 'Show'}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {help && <p className="mt-1.5 text-xs text-muted">{help}</p>}
    </div>
  )
}

function KeyStatus({ label, result }: { label: string; result: KeyCheck | undefined }): React.JSX.Element | null {
  if (!result) return null
  const ok = result === 'ok'
  const text = result === 'ok' ? 'working' : result === 'missing' ? 'not set' : result === 'invalid' ? 'rejected: check the key' : result.error
  return (
    <span className={cn('flex items-center gap-1.5 text-sm', ok ? 'text-emerald-400' : result === 'missing' ? 'text-muted' : 'text-accent')}>
      {ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
      {label} {text}
    </span>
  )
}

/** Shows which controller is connected (reported by the GamepadLayer). */
function ControllerStatus(): React.JSX.Element {
  const [kind, setKind] = useState<string | null>(null)
  useEffect(() => {
    const on = (e: Event): void => setKind((e as CustomEvent<string | null>).detail)
    window.addEventListener('vanity:controller', on)
    // Ask for the current state.
    const pads = [...(navigator.getGamepads?.() ?? [])].filter((p) => p?.connected)
    setKind(pads[0] ? pads[0].id : null)
    return () => window.removeEventListener('vanity:controller', on)
  }, [])
  const label = !kind
    ? 'No controller connected'
    : kind === 'playstation'
      ? 'PlayStation controller connected'
      : kind === 'xbox'
        ? 'Xbox controller connected'
        : kind === 'generic'
          ? 'Controller connected'
          : `Connected: ${kind}`
  return (
    <p className={cn('flex items-center gap-2 px-3 pb-1 text-sm', kind ? 'text-emerald-400' : 'text-muted')}>
      <Gamepad className="size-4" /> {label}
    </p>
  )
}

/** Version, update channel and "Check now". A downloaded copy (not a git clone) needs a GitHub token. */
function UpdatesSection({
  settings,
  save
}: {
  settings: Settings
  save: (patch: Partial<Settings>, confirmation?: string) => Promise<void>
}): React.JSX.Element | null {
  const update = useUpdate()
  if (!update) return null
  const count = pendingCount(update)
  return (
    <Section
      title="Updates"
    >
      <div className="flex flex-wrap items-center gap-4">
        {count > 0 ? (
          <Button variant="primary" className="h-11 px-5" onClick={openUpdateDialog}>
            <ArrowDownToLine className="size-4" /> Install v{update.latest}
          </Button>
        ) : (
          <Button variant="primary" className="h-11 px-5" onClick={() => void checkForUpdate()} disabled={update.checking || update.mode === 'unsupported'} data-check-updates>
            <RefreshCw className={cn('size-4', update.checking && 'animate-spin')} /> {update.checking ? 'Checking…' : 'Check now'}
          </Button>
        )}
        <span className="text-sm text-muted">
          {count > 0
            ? `v${update.latest} is ready to install.`
            : update.progress != null
              ? `Downloading v${update.latest} in the background… ${update.progress}%`
              : update.needsToken
                ? 'Add a GitHub token below to get updates.'
                : update.error
                  ? update.error
                  : update.lastChecked
                    ? `You are on the up to date version (v${update.current}). Checked ${formatAgo(update.lastChecked)}.`
                    : `Vanity v${update.current}`}
        </span>
      </div>
      {update.mode === 'vercel' && update.error && (
        <div className="mt-5">
          <SecretField
            label="Update key (optional)"
            value={settings.updateKey}
            onSave={(v) => void save({ updateKey: v }, v ? 'Update key saved' : 'Update key removed')}
            help={
              <>
                Only needed if you set <code className="rounded bg-white/5 px-1">UPDATE_KEY</code> on your Vercel server, so that only you can download Vanity
                from it.
              </>
            }
          />
        </div>
      )}
      {update.mode === 'github' && update.needsToken && (
        <div className="mt-5">
          <SecretField
            label="GitHub token"
            value={settings.githubToken}
            onSave={(v) => void save({ githubToken: v }, v ? 'GitHub token saved' : 'GitHub token removed')}
            help={
              <>
                The Vanity repo is private, so a copy that wasn't made with git clone needs a token to download updates. Create a fine-grained token at{' '}
                <a className="text-accent hover:underline" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
                  github.com/settings/personal-access-tokens
                </a>{' '}
                with read-only access to the repo's Contents. It's stored encrypted on this PC.
              </>
            }
          />
        </div>
      )}
    </Section>
  )
}

const DISCORD_STATE: Record<DiscordStatus['state'], { dot: string; text: string }> = {
  off: { dot: 'bg-white/30', text: 'Off' },
  'needs-id': { dot: 'bg-amber-400', text: 'No Discord application ID in this build' },
  connecting: { dot: 'bg-amber-400 animate-pulse', text: 'Connecting to Discord…' },
  connected: { dot: 'bg-emerald-400', text: 'Connected' },
  unavailable: { dot: 'bg-red-400', text: "Can't reach Discord" }
}

/** Discord Rich Presence: on/off, the application ID, and whether it's connected. */
function DiscordSection({
  settings,
  save
}: {
  settings: Settings
  save: (patch: Partial<Settings>, confirmation?: string) => Promise<void>
}): React.JSX.Element {
  const [status, setStatus] = useState<DiscordStatus | null>(null)
  useEffect(() => {
    window.vanity.discord.status().then(setStatus, () => {})
    return window.vanity.discord.onStatus(setStatus)
  }, [])
  const shown = DISCORD_STATE[status?.state ?? 'off']

  // The Discord application ID is built in (src/main/builtinKeys.ts), so there's nothing to set up here.
  return (
    <Section
      title="Discord"
      description="Show Vanity on your Discord profile: the game you're playing and for how long, and the song in the music player. When you do both, the game is shown with the song under it."
    >
      <div className="-mx-3">
        <Toggle label="Discord Rich Presence" checked={!!settings.discordPresence} onChange={(v) => save({ discordPresence: v })} />
      </div>
      {settings.discordPresence && (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <span className={cn('size-2 rounded-full', shown.dot)} />
          {status?.state === 'connected' && status.user ? `Connected as ${status.user}` : shown.text}
          {status?.error && status.state !== 'connected' && <span className="text-xs">· {status.error}</span>}
        </p>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted">
        The Discord app must be running on this PC, with Discord's Settings → Activity Privacy → "Share your detected activities" turned on.
      </p>
    </Section>
  )
}

/** Games you removed are skipped by scans; this brings them back. */
function RemovedGames(): React.JSX.Element | null {
  const { scan } = useLibrary()
  const toast = useToast()
  const [names, setNames] = useState<string[]>([])
  const load = (): void => void window.vanity.games.removed().then(setNames, () => {})
  useEffect(load, [scan.running])
  if (names.length === 0) return null
  return (
    <p className="mt-4 text-sm text-muted">
      {names.length} removed game{names.length > 1 ? 's are' : ' is'} being skipped ({names.slice(0, 3).join(', ')}
      {names.length > 3 ? '…' : ''}).{' '}
      <button
        className="font-medium text-accent hover:underline"
        onClick={async () => {
          await window.vanity.games.restoreRemoved()
          toast('Removed games will come back on the next scan')
          await scan.start()
          load()
        }}
      >
        Restore
      </button>
    </p>
  )
}

/** Android: playtime is exact when Vanity may read app usage; this explains it and opens the setting. */
function PlaytimeSection(): React.JSX.Element {
  const [granted, setGranted] = useState<boolean | null>(null)
  useEffect(() => {
    const check = (): void => void window.vanity.playtime.usageAccess().then(setGranted, () => {})
    check()
    // Coming back from Android's settings: check again.
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [])
  return (
    <Section
      title="Playtime tracking"
      description="Android doesn't let apps watch each other, so Vanity needs your permission to see how long games were open."
    >
      <p className="flex items-center gap-2 text-sm">
        <span className={cn('size-2 rounded-full', granted ? 'bg-emerald-400' : 'bg-amber-400')} />
        {granted
          ? 'Usage access is on: playtime is exact, and games you open outside Vanity are counted too.'
          : 'Usage access is off: Vanity counts from when you press Play until you come back to it.'}
      </p>
      {!granted && (
        <div className="mt-4">
          <Button variant="primary" onClick={() => void window.vanity.playtime.openUsageSettings()}>
            Turn on usage access
          </Button>
          <p className="mt-2 text-xs text-muted">
            In the list that opens, choose Vanity and allow usage access. Vanity only looks at the games in your library.
          </p>
        </div>
      )}
    </Section>
  )
}

export function SettingsPage(): React.JSX.Element {
  const { scan, metadata } = useLibrary()
  const toast = useToast()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [keyCheck, setKeyCheck] = useState<{ steamGridDb: KeyCheck; igdb: KeyCheck } | null>(null)
  const [checking, setChecking] = useState(false)
  // The page you were on last time opens again.
  const [tab, setTabState] = useState<SettingsTab>(() => {
    const saved = loadPref<{ tab: SettingsTab }>('settings-tab', { tab: 'look' }).tab
    return SETTINGS_TABS.some((t) => t.id === saved) ? saved : 'look'
  })
  const setTab = (next: SettingsTab): void => {
    setTabState(next)
    savePref('settings-tab', { tab: next })
  }
  const updates = pendingCount(useUpdate())
  const isAdmin = useAccount()?.admin === true
  // The Admin tab is only there for admins: anyone else who had it open lands on the first tab.
  useEffect(() => {
    if (tab === 'admin' && !isAdmin) setTabState('look')
  }, [tab, isAdmin])

  async function checkKeys(): Promise<void> {
    setChecking(true)
    try {
      setKeyCheck(await window.vanity.metadata.checkKeys())
    } catch (err) {
      toast(`Could not check keys: ${err instanceof Error ? err.message : err}`, 'error')
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    window.vanity.settings.get().then(setSettings, (err) => toast(`Could not load settings: ${err}`, 'error'))
  }, [toast])
  // Settings changed somewhere else while this page is open (the scan window, another device) show here too.
  const live = useSettings()
  useEffect(() => {
    if (live) setSettings(live)
  }, [live])

  async function save(patch: Partial<Settings>, confirmation?: string): Promise<void> {
    try {
      setSettings(await saveSettings(patch))
      if (confirmation) toast(confirmation)
    } catch (err) {
      toast(`Could not save settings: ${err instanceof Error ? err.message : err}`, 'error')
    }
  }

  async function addFolder(): Promise<void> {
    if (!settings) return
    const folder = await window.vanity.settings.pickFolder()
    if (!folder) return
    if (settings.customFolders.some((f) => f.toLowerCase() === folder.toLowerCase())) {
      toast('That folder is already in the list')
      return
    }
    await save({ customFolders: [...settings.customFolders, folder] }, 'Folder added. Rescan to find its games.')
  }

  if (!settings) return <div className="p-10" />
  const android = isAndroid()

  return (
    <div className="h-full overflow-y-auto">
      <div className="stagger mx-auto w-full max-w-[1700px] space-y-6 px-10 pb-16 pt-12">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>

        <div role="tablist" aria-label="Settings sections" className="sticky top-0 z-10 -mx-2 flex gap-1 max-md:mx-0 overflow-x-auto rounded-2xl border border-border bg-surface/90 p-1.5 backdrop-blur [scrollbar-width:none]">
          {SETTINGS_TABS.filter((t) => t.id !== 'admin' || isAdmin).map((t) => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={cn(
                  'relative flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition max-md:px-2 max-md:text-[13px]',
                  active ? 'bg-accent text-white shadow-lg shadow-accent/25' : 'text-muted hover:bg-white/5 hover:text-text'
                )}
              >
                <Icon className="size-4 max-md:hidden" /> {t.label}
                {t.id === 'updates' && updates > 0 && <span className="size-2 rounded-full bg-accent ring-2 ring-surface" aria-label="Update available" />}
              </button>
            )
          })}
        </div>
        {tab === 'look' && (
        <Section title="Appearance" description="Make Vanity yours: a colour skin, a font, and a little ambience.">
          <h3 className="mb-3 text-sm font-semibold text-muted">Skin</h3>
          <div className="grid grid-cols-4 gap-3 max-md:grid-cols-2 xl:grid-cols-6 2xl:grid-cols-8">
            {THEMES.map((t) => {
              const active = (settings.theme ?? 'midnight') === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    applyTheme(t.id)
                    void save({ theme: t.id })
                  }}
                  aria-pressed={active}
                  className={cn(
                    'group overflow-hidden rounded-xl border text-left transition duration-200 hover:-translate-y-0.5',
                    active ? 'border-accent ring-2 ring-accent/40' : 'border-border hover:border-white/25'
                  )}
                >
                  {/* Mini preview: sidebar, a card and an accent button in the skin's colours. */}
                  <div className="flex h-16 gap-2 p-2" style={{ background: t.colors.bg }}>
                    <div className="w-6 space-y-1.5 rounded-md p-1" style={{ background: t.colors.surface }}>
                      <div className="h-1.5 rounded-full" style={{ background: t.colors.accent }} />
                      <div className="h-1.5 rounded-full" style={{ background: t.colors.border }} />
                      <div className="h-1.5 rounded-full" style={{ background: t.colors.border }} />
                    </div>
                    <div className="flex flex-1 flex-col justify-between rounded-md p-1.5" style={{ background: t.colors.surface2 }}>
                      <div className="h-1.5 w-2/3 rounded-full" style={{ background: t.colors.muted }} />
                      <div className="h-3.5 w-10 rounded" style={{ background: `linear-gradient(135deg, ${t.colors.accent}, ${t.colors.accent2})` }} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 text-sm" style={{ background: t.colors.surface, color: t.colors.text }}>
                    {t.name}
                    {active && <span className="size-2 rounded-full" style={{ background: t.colors.accent }} />}
                  </div>
                </button>
              )
            })}
          </div>

          <h3 className="mb-1 mt-7 text-sm font-semibold text-muted">Font</h3>
          <p className="mb-4 text-xs text-muted">
            Every font is built in, so it works offline. A font changes all the text in Vanity. Themes that pair two fonts use the second only for long
            descriptions and notes.
          </p>
          {FONT_GROUPS.map((group) => (
            <div key={group} className="mb-5 last:mb-0">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted/80">{group}</h4>
              <div className="grid grid-cols-3 gap-3 max-md:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-6">
                {FONT_THEMES.filter((f) => f.group === group).map((f) => {
                  const active = (settings.font ?? 'system') === f.id
                  return (
                    <button
                      key={f.id}
                      onClick={() => {
                        applyFont(f.id)
                        void save({ font: f.id })
                      }}
                      aria-pressed={active}
                      title={f.name}
                      className={cn(
                        'relative rounded-xl border bg-surface-2 px-3 py-3 text-left transition duration-200 hover:-translate-y-0.5',
                        active ? 'border-accent ring-2 ring-accent/40' : 'border-border hover:border-white/25'
                      )}
                    >
                      <span className="block truncate text-2xl leading-none" style={{ fontFamily: f.display }}>
                        Aa <span className="text-base text-muted">Play</span>
                      </span>
                      <span className="mt-2 block truncate text-xs text-muted" style={{ fontFamily: f.body }}>
                        {f.name}
                      </span>
                      {active && <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-accent" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="-mx-3 mt-6 border-t border-border pt-3">
            <Toggle label="Ambient background glow" checked={settings.ambientBackground !== false} onChange={(v) => save({ ambientBackground: v })} />
            {!android && (
              <div data-close-to-background>
                <Toggle label="Keep Vanity running in the background when I close it" hint="Closing the window only hides it, so calls, messages and downloads carry on. Open it again from the Vanity icon by the clock; right-click that icon to quit." checked={settings.closeToBackground !== false} onChange={(v) => save({ closeToBackground: v })} />
              </div>
            )}
            {!android && (
              <Toggle
                label="Minimise Vanity while a game is running"
                checked={!!settings.minimizeWhilePlaying}
                onChange={(v) => save({ minimizeWhilePlaying: v })}
              />
            )}
          </div>
        </Section>
        )}

        {tab === 'customize' && (
          <div className="settings-columns">
            <CustomizeSettings options={settings.interface} onChange={(next, note) => save({ interface: next }, note)} />
          </div>
        )}

        {tab === 'voice' && (
          <div className="settings-columns">
            <VoiceSettingsPanel settings={settings.voice} />
          </div>
        )}

        {tab === 'playing' && (
          <div className="settings-columns">

        <Section
          title="Controller"
          description="Use a gamepad anywhere in Vanity. D-pad or left stick moves, A selects, B goes back, X opens options, Y searches, LB/RB switch tabs, Start plays. Press a button on your controller to wake it."
        >
          <div className="-mx-3">
            <ControllerStatus />
            <Toggle label="Controller navigation" checked={settings.controllerEnabled !== false} onChange={(v) => save({ controllerEnabled: v })} />
          </div>
        </Section>

        {!android && (
          <Section title="Wellbeing" description="While a game is running, Vanity can nudge you to take a break with a Windows notification.">
            <p className="mb-2 text-sm font-medium">Remind me to take a break every</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Break reminders">
              {[0, 30, 60, 90, 120, 180].map((m) => {
                const active = (settings.breakReminderMinutes ?? 0) === m
                return (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={active}
                    onClick={() =>
                      save(
                        { breakReminderMinutes: m },
                        m ? `Break reminders every ${m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}` : 'Break reminders off'
                      )
                    }
                    className={cn(
                      'rounded-lg border px-3.5 py-2 text-sm transition',
                      active ? 'border-accent bg-accent/15 font-semibold text-text' : 'border-border text-muted hover:border-white/25 hover:text-text'
                    )}
                  >
                    {m === 0 ? 'Off' : m < 60 ? `${m} min` : `${m / 60} h`}
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {!android && <DiscordSection settings={settings} save={save} />}

        {android && <PlaytimeSection />}
          </div>
        )}

        {tab === 'admin' && isAdmin && <AdminPanel />}

        {tab === 'updates' && (
          <>

        <UpdatesSection settings={settings} save={save} />
          </>
        )}

        {tab === 'library' && (
          <div className="settings-columns">

        <Section
          title="Library scan"
          description={
            android
              ? 'Vanity looks for the games installed on your phone every time it opens. Rescanning never creates duplicates.'
              : 'Vanity looks for installed games in the launchers below and in your own folders, every time it opens. Rescanning never creates duplicates.'
          }
        >
          <div className="flex items-center gap-4">
            <Button variant="primary" onClick={scan.start} disabled={scan.running}>
              <RefreshCw className={cn('size-4', scan.running && 'animate-spin')} />
              {scan.running ? 'Scanning…' : 'Rescan now'}
            </Button>
            {!SHOW_API_KEYS && (
              <Button onClick={() => window.vanity.metadata.refreshAll()} disabled={metadata.running}>
                <RefreshCw className={cn('size-4', metadata.running && 'animate-spin')} />
                {metadata.running ? `Fetching ${Math.min(metadata.done, metadata.total)}/${metadata.total}…` : 'Refresh all metadata'}
              </Button>
            )}
            {scan.last && !scan.running && (
              <span className="text-sm text-muted">
                Last scan: {scan.last.added} new, {scan.last.updated} updated
                {scan.last.candidates.length > 0 && `, ${scan.last.candidates.length} found in your folders`}
                {scan.last.missing > 0 && `, ${scan.last.missing} no longer found`}
              </span>
            )}
          </div>
          {scan.progress.length > 0 && (
            <div className="mt-5">
              <ScanProgressPanel progress={scan.progress} />
            </div>
          )}
          <RemovedGames />
        </Section>

        {!android && (
          <Section title="Launchers" description="Turn off a source to skip it during scans. Games already in your library stay.">
            <div className="-mx-3">
              {SCAN_SOURCES.map((s) => (
                <Toggle
                  key={s}
                  label={SOURCE_LABELS[s]}
                  checked={settings.enabledSources[s]}
                  onChange={(v) => save({ enabledSources: { ...settings.enabledSources, [s]: v } })}
                />
              ))}
            </div>
          </Section>
        )}

        {!android && (
          <Section
            title="Game folders"
            description="Folders with games that don't come from a launcher. Each subfolder is treated as one game, and you confirm what gets added."
          >
            {settings.customFolders.length > 0 && (
              <ul className="mb-4 divide-y divide-border overflow-hidden rounded-xl border border-border">
                {settings.customFolders.map((f) => (
                  <li key={f} className="flex items-center gap-3 bg-surface-2 px-4 py-3 text-sm">
                    <span className="flex-1 truncate" title={f}>
                      {f}
                    </span>
                    <button
                      className="rounded p-1 text-muted transition hover:text-accent"
                      title="Remove folder"
                      onClick={() => save({ customFolders: settings.customFolders.filter((x) => x !== f) })}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-4">
              <Button onClick={addFolder}>
                <FolderPlus className="size-4" /> Add folder
              </Button>
            </div>
          </Section>
        )}

        {tab === 'library' && !isAndroid() && (
          <Section title="Scan Block List" description="Files the scanner always skips: the ones you chose “Always ignore” for, or unticked, in scan results. Remove one and the next scan suggests it again.">
            {settings.ignoredExecutables.length === 0 ? (
              <p className="text-sm text-muted" data-block-list="empty">
                Nothing is blocked. When a scan finds a file that isn't a game, right-click it and choose “Always ignore this file”.
              </p>
            ) : (
              <>
                <ul className="mb-4 max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border [scrollbar-width:thin]" data-block-list={settings.ignoredExecutables.length}>
                  {settings.ignoredExecutables.map((f) => (
                    <li key={f} className="flex items-center gap-3 bg-surface-2 px-4 py-2.5 text-sm" data-blocked-file={f}>
                      <Ban className="size-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{exeName(f)}</span>
                        <span className="block truncate text-xs text-muted" title={f}>
                          {f}
                        </span>
                      </span>
                      <Button onClick={() => save({ ignoredExecutables: unblockExe(settings.ignoredExecutables, f) }, `${exeName(f)} will be suggested again on the next scan`)} data-unblock>
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button onClick={() => save({ ignoredExecutables: [] }, 'The block list is empty: everything will be suggested again on the next scan')} data-unblock-all>
                  <Trash2 className="size-4" /> Clear all ({settings.ignoredExecutables.length})
                </Button>
              </>
            )}
          </Section>
        )}

        {SHOW_API_KEYS && (
          <Section
            title="Metadata & artwork"
            description="Free API credentials for covers, banners, logos, descriptions and genres, and for the Trending tab (Twitch client ID and secret). Steam games also get artwork and details from Steam without any key. Stored encrypted on this PC; keys built in from .env.local are filled in automatically."
          >
            <div className="space-y-5">
              <SecretField
                label="SteamGridDB API key"
                value={settings.steamGridDbApiKey}
                onSave={(v) => save({ steamGridDbApiKey: v }, 'SteamGridDB key saved')}
                help={
                  <>
                    Get one at{' '}
                    <a className="text-accent hover:underline" href="https://www.steamgriddb.com/profile/preferences/api" target="_blank" rel="noreferrer">
                      steamgriddb.com → Preferences → API
                    </a>
                  </>
                }
              />
              <SecretField
                label="IGDB client ID"
                value={settings.igdbClientId}
                onSave={(v) => save({ igdbClientId: v }, 'IGDB client ID saved')}
                help={
                  <>
                    Register an application at{' '}
                    <a className="text-accent hover:underline" href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">
                      dev.twitch.tv/console/apps
                    </a>{' '}
                    (category "Application Integration", redirect URL http://localhost).
                  </>
                }
              />
              <SecretField
                label="IGDB client secret"
                value={settings.igdbClientSecret}
                onSave={(v) => save({ igdbClientSecret: v }, 'IGDB client secret saved')}
              />
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-border pt-5">
                <Button onClick={checkKeys} disabled={checking}>
                  <KeyRound className="size-4" /> {checking ? 'Checking…' : 'Check keys'}
                </Button>
                <Button onClick={() => window.vanity.metadata.refreshAll()} disabled={metadata.running}>
                  <RefreshCw className={cn('size-4', metadata.running && 'animate-spin')} />
                  {metadata.running ? `Fetching ${Math.min(metadata.done, metadata.total)}/${metadata.total}…` : 'Refresh all metadata'}
                </Button>
                <KeyStatus label="SteamGridDB" result={keyCheck?.steamGridDb} />
                <KeyStatus label="IGDB" result={keyCheck?.igdb} />
              </div>
            </div>
          </Section>
        )}
          </div>
        )}
      </div>
    </div>
  )
}
