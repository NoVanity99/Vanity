import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, FolderPlus, KeyRound, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { THEMES } from '@shared/themes'
import { SCAN_SOURCES, SOURCE_LABELS, type KeyCheck, type Settings } from '@shared/types'
import { FONT_THEMES } from '@shared/fonts'
import { applyFont, applyTheme } from '@/lib/theme'
import { saveSettings } from '@/state/settings'
import { Button } from '@/components/Dialog'
import { ScanProgressPanel } from '@/components/ScanProgressPanel'
import { cn } from '@/lib/cn'
import { useLibrary } from '@/state/library'
import { useToast } from '@/state/toasts'

/**
 * Shows the "Metadata & artwork" section with the API key fields.
 * Set to false to hide it (e.g. when keys are built in from .env.local).
 */
const SHOW_API_KEYS = true

function Section({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="rounded-2xl border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm transition hover:bg-white/5"
    >
      {label}
      <span className={cn('relative block h-6 w-11 shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-accent' : 'bg-white/15')}>
        <span
          className={cn(
            'absolute left-0 top-1 size-4 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-6' : 'translate-x-1'
          )}
        />
      </span>
    </button>
  )
}

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
  const text =
    result === 'ok' ? 'working' : result === 'missing' ? 'not set' : result === 'invalid' ? 'rejected: check the key' : result.error
  return (
    <span className={cn('flex items-center gap-1.5 text-sm', ok ? 'text-emerald-400' : result === 'missing' ? 'text-muted' : 'text-accent')}>
      {ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
      {label} {text}
    </span>
  )
}

export function SettingsPage(): React.JSX.Element {
  const { scan, metadata } = useLibrary()
  const toast = useToast()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [keyCheck, setKeyCheck] = useState<{ steamGridDb: KeyCheck; igdb: KeyCheck } | null>(null)
  const [checking, setChecking] = useState(false)

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

  return (
    <div className="h-full overflow-y-auto">
      <div className="stagger mx-auto max-w-3xl space-y-6 px-10 pb-16 pt-12">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>

        <Section title="Appearance" description="Make Vanity yours: a colour skin, a font, and a little ambience.">
          <h3 className="mb-3 text-sm font-semibold text-muted">Skin</h3>
          <div className="grid grid-cols-4 gap-3">
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

          <h3 className="mb-3 mt-7 text-sm font-semibold text-muted">Font</h3>
          <div className="grid grid-cols-4 gap-3">
            {FONT_THEMES.map((f) => {
              const active = (settings.font ?? 'system') === f.id
              return (
                <button
                  key={f.id}
                  onClick={() => {
                    applyFont(f.id)
                    void save({ font: f.id })
                  }}
                  aria-pressed={active}
                  className={cn(
                    'rounded-xl border bg-surface-2 px-3 py-3 text-left transition duration-200 hover:-translate-y-0.5',
                    active ? 'border-accent ring-2 ring-accent/40' : 'border-border hover:border-white/25'
                  )}
                >
                  <span className="block text-2xl leading-none" style={{ fontFamily: f.display }}>
                    Aa
                  </span>
                  <span className="mt-2 block truncate text-xs text-muted" style={{ fontFamily: f.body }}>
                    {f.name}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="-mx-3 mt-6 border-t border-border pt-3">
            <Toggle
              label="Ambient background glow"
              checked={settings.ambientBackground !== false}
              onChange={(v) => save({ ambientBackground: v })}
            />
            <Toggle
              label="Minimise Vanity while a game is running"
              checked={!!settings.minimizeWhilePlaying}
              onChange={(v) => save({ minimizeWhilePlaying: v })}
            />
          </div>
        </Section>

        <Section
          title="Library scan"
          description="Vanity looks for installed games in the launchers below and in your own folders. Rescanning never creates duplicates."
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
        </Section>

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
            {settings.ignoredExecutables.length > 0 && (
              <button
                className="text-sm text-muted transition hover:text-text"
                onClick={() => save({ ignoredExecutables: [] }, 'Declined items will be suggested again on the next scan')}
              >
                Reset {settings.ignoredExecutables.length} declined item{settings.ignoredExecutables.length > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </Section>

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
    </div>
  )
}
