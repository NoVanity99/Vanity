import { useCallback, useEffect, useMemo, useState } from 'react'
import { SCAN_SOURCES, SOURCE_LABELS, type Game, type GameCandidate, type GameSource, type ScanSummary, type Settings } from '@shared/types'
import { CandidateReview } from '@/components/CandidateReview'
import { ScanProgressPanel } from '@/components/ScanProgressPanel'
import { useScan } from '@/hooks/useScan'

/**
 * Test page for scanning and the library (stages 1–2). The real Library grid and Settings page
 * replace it in stage 3; the scan pieces (progress, review) are reused there.
 */
export function ScanPreview(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [games, setGames] = useState<Game[]>([])
  const [candidates, setCandidates] = useState<GameCandidate[]>([])
  const [lastSummary, setLastSummary] = useState<ScanSummary | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refreshGames = useCallback(() => window.vanity.games.list().then(setGames), [])

  async function updateGame(id: number, patch: Parameters<typeof window.vanity.games.update>[1]): Promise<void> {
    const updated = await window.vanity.games.update(id, patch)
    if (updated) setGames((gs) => gs.map((g) => (g.id === id ? updated : g)))
  }

  async function removeGame(id: number): Promise<void> {
    await window.vanity.games.remove(id)
    setGames((gs) => gs.filter((g) => g.id !== id))
  }

  useEffect(() => {
    window.vanity.settings.get().then(setSettings)
    refreshGames()
  }, [refreshGames])

  const onFinished = useCallback(
    (summary: ScanSummary) => {
      setLastSummary(summary)
      setCandidates(summary.candidates)
      refreshGames()
    },
    [refreshGames]
  )
  const scan = useScan(onFinished)

  async function patchSettings(patch: Partial<Settings>): Promise<void> {
    setSettings(await window.vanity.settings.update(patch))
  }

  async function addFolder(): Promise<void> {
    const folder = await window.vanity.settings.pickFolder()
    if (folder && settings && !settings.customFolders.includes(folder)) {
      await patchSettings({ customFolders: [...settings.customFolders, folder] })
    }
  }

  async function addManually(): Promise<void> {
    const game = await window.vanity.games.addManually()
    if (game) {
      setNotice(`Added ${game.name}`)
      refreshGames()
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<GameSource, Game[]>()
    for (const g of [...games].sort((a, b) => a.name.localeCompare(b.name))) {
      map.set(g.source, [...(map.get(g.source) ?? []), g])
    }
    return [...map.entries()]
  }, [games])

  if (!settings) return <div className="p-10 text-muted">Loading…</div>

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-8 px-10 pb-16 pt-14">
        <header>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Stage 2 preview</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Game scanning &amp; library</h1>
          <p className="mt-2 text-muted">
            Your library is saved locally and survives restarts. The cover-art grid replaces this page in stage 3.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-3 font-semibold">Sources</h2>
            <div className="space-y-2">
              {SCAN_SOURCES.map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-accent"
                    checked={settings.enabledSources[s]}
                    onChange={(e) => patchSettings({ enabledSources: { ...settings.enabledSources, [s]: e.target.checked } })}
                  />
                  {SOURCE_LABELS[s]}
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Custom folders</h2>
              <button className="text-sm text-accent hover:underline" onClick={addFolder}>
                Add folder
              </button>
            </div>
            {settings.customFolders.length === 0 ? (
              <p className="text-sm text-muted">No folders yet. Add one that contains your games.</p>
            ) : (
              <ul className="space-y-1.5">
                {settings.customFolders.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate" title={f}>
                      {f}
                    </span>
                    <button
                      className="text-muted hover:text-accent"
                      title="Remove folder"
                      onClick={() => patchSettings({ customFolders: settings.customFolders.filter((x) => x !== f) })}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {settings.ignoredExecutables.length > 0 && (
              <button
                className="mt-3 text-xs text-muted hover:text-text"
                onClick={() => patchSettings({ ignoredExecutables: [] })}
              >
                Reset {settings.ignoredExecutables.length} ignored item(s)
              </button>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg bg-accent px-6 py-2.5 font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              onClick={scan.start}
              disabled={scan.scanning}
            >
              {scan.scanning ? 'Scanning…' : 'Scan now'}
            </button>
            <button
              className="rounded-lg border border-border px-5 py-2.5 text-sm transition hover:bg-surface-2"
              onClick={addManually}
            >
              Add game manually
            </button>
            {lastSummary && !scan.scanning && (
              <span className="text-sm text-muted">
                {lastSummary.added} new, {lastSummary.updated} already known
                {lastSummary.missing > 0 && `, ${lastSummary.missing} no longer found`}
              </span>
            )}
            {notice && <span className="text-sm text-emerald-400">{notice}</span>}
            {scan.error && <span className="text-sm text-accent">{scan.error}</span>}
          </div>
          <ScanProgressPanel progress={scan.progress} />
        </section>

        <section className="space-y-6">
          <h2 className="text-xl font-semibold">
            Found games <span className="text-muted">({games.length})</span>
          </h2>
          {grouped.length === 0 && <p className="text-muted">Nothing yet. Run a scan.</p>}
          {grouped.map(([source, list]) => (
            <div key={source}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
                {SOURCE_LABELS[source]} · {list.length}
              </h3>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {list.map((g) => (
                  <li key={g.id} className={`group flex items-center gap-3 px-4 py-2.5 ${g.hidden ? 'opacity-45' : ''}`}>
                    <button
                      className={`text-lg leading-none transition ${g.favorite ? 'text-amber-400' : 'text-border hover:text-muted'}`}
                      title={g.favorite ? 'Remove from favorites' : 'Add to favorites'}
                      onClick={() => updateGame(g.id, { favorite: !g.favorite })}
                    >
                      ★
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-3">
                        <span className="font-medium">{g.name}</span>
                        {g.source !== 'custom' && g.source !== 'manual' && (
                          <span className="text-xs text-muted">{g.externalId}</span>
                        )}
                        {g.missing && (
                          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">Not found</span>
                        )}
                        {g.hidden && <span className="text-[11px] text-muted">Hidden</span>}
                      </div>
                      <p className="truncate text-xs text-muted">{g.executablePath ?? g.installPath}</p>
                    </div>
                    <div className="flex gap-3 text-xs text-muted opacity-0 transition group-hover:opacity-100">
                      <button className="hover:text-text" onClick={() => updateGame(g.id, { hidden: !g.hidden })}>
                        {g.hidden ? 'Unhide' : 'Hide'}
                      </button>
                      <button className="hover:text-accent" onClick={() => removeGame(g.id)}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>

      {candidates.length > 0 && (
        <CandidateReview
          candidates={candidates}
          onDone={() => {
            setCandidates([])
            refreshGames()
          }}
        />
      )}
    </div>
  )
}
