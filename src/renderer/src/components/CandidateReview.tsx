import { useEffect, useState } from 'react'
import { Ban } from 'lucide-react'
import { blockExe, exeName, normalizeExePath } from '@shared/scanBlock'
import type { GameCandidate } from '@shared/types'
import { saveSettings } from '@/state/settings'

interface Row {
  candidate: GameCandidate
  selected: boolean
  name: string
  exe: string
}

interface Props {
  candidates: GameCandidate[]
  /** Called with the number of games added (0 if the dialog was dismissed). */
  onDone: (added: number) => void
}

/** Lets the user confirm which custom-folder finds are games, rename them and pick the right exe. */
export function CandidateReview({ candidates, onDone }: Props): React.JSX.Element {
  const [rows, setRows] = useState<Row[]>(() =>
    candidates.map((c) => ({ candidate: c, selected: true, name: c.name, exe: c.executablePath! }))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** "Always ignore this file": onto the scan block list now, and out of this list. */
  const [menu, setMenu] = useState<{ x: number; y: number; row: Row } | null>(null)
  const [blockedNow, setBlockedNow] = useState(0)
  const ignore = async (row: Row): Promise<void> => {
    setMenu(null)
    try {
      const current = await window.vanity.settings.get()
      await saveSettings({ ignoredExecutables: blockExe(current.ignoredExecutables, row.exe) })
    } catch (err) {
      return setError(err instanceof Error ? err.message : String(err))
    }
    // If the folder has another program, that one stays as the suggestion; otherwise the row goes.
    const others = [row.candidate.executablePath!, ...row.candidate.alternatives].filter((e) => normalizeExePath(e) !== normalizeExePath(row.exe))
    setBlockedNow((n) => n + 1)
    setRows((rs) => rs.flatMap((r) => (r !== row ? [r] : others.length ? [{ ...r, exe: others[0], candidate: { ...r.candidate, executablePath: others[0], alternatives: others.slice(1) } }] : [])))
  }
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const update = (i: number, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      const toCandidate = (r: Row): GameCandidate => ({ ...r.candidate, name: r.name, executablePath: r.exe })
      const added = await window.vanity.games.confirmCandidates(
        rows.filter((r) => r.selected).map(toCandidate),
        rows.filter((r) => !r.selected).map((r) => r.candidate)
      )
      onDone(added.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  const count = rows.filter((r) => r.selected).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8 backdrop-blur-sm">
      <div className="flex max-h-full w-full max-w-4xl flex-col rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="border-b border-border p-6">
          <h2 className="text-xl font-semibold">Review games found in your folders</h2>
          <p className="mt-1 text-sm text-muted">
            Untick anything that isn't a game: unticked items won't be suggested again. Right-click a file (or use its button) to always ignore it. Ignored files are listed in Settings → Library → Scan Block List.
          </p>
        </div>
        <ul className="flex-1 divide-y divide-border overflow-y-auto">
          {rows.map((r, i) => (
            <li
              key={r.candidate.externalId}
              className="flex items-center gap-4 px-6 py-3"
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, row: r })
              }}
              data-candidate={r.exe}
            >
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={r.selected}
                onChange={(e) => update(i, { selected: e.target.checked })}
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <input
                  className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 font-medium outline-none hover:border-border focus:border-accent"
                  value={r.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                {r.candidate.alternatives.length > 0 ? (
                  <select
                    className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-muted"
                    value={r.exe}
                    onChange={(e) => update(i, { exe: e.target.value })}
                  >
                    {[r.candidate.executablePath!, ...r.candidate.alternatives].map((exe) => (
                      <option key={exe} value={exe}>
                        {exe}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="truncate px-2 text-xs text-muted">{r.exe}</p>
                )}
              </div>
              <button onClick={() => void ignore(r)} title={`Always ignore ${exeName(r.exe)}: never suggest this file again`} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted transition hover:border-accent/60 hover:text-accent" data-always-ignore>
                <Ban className="size-3.5" /> Always ignore
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-end gap-3 border-t border-border p-4">
          {error && <span className="mr-auto text-sm text-accent">{error}</span>}
          {!error && blockedNow > 0 && <span className="mr-auto text-xs text-muted" data-blocked-now>{blockedNow} file{blockedNow === 1 ? '' : 's'} added to the Scan Block List</span>}
          <button className="rounded-lg px-4 py-2 text-sm text-muted hover:text-text" onClick={() => onDone(0)} disabled={saving}>
            Decide later
          </button>
          <button
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            onClick={save}
            disabled={saving}
          >
            {count === 0 ? 'Ignore all' : `Add ${count} game${count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
      {menu && (
        <div className="fixed z-[60] w-56 animate-pop-in overflow-hidden rounded-xl border border-border bg-surface-2 py-1 text-sm shadow-2xl" style={{ left: Math.min(menu.x, window.innerWidth - 236), top: Math.min(menu.y, window.innerHeight - 60) }} role="menu">
          <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-accent hover:bg-white/8" onClick={() => void ignore(menu.row)} data-menu-always-ignore>
            <Ban className="size-4" /> Always ignore this file
          </button>
        </div>
      )}
    </div>
  )
}
