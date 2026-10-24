import { useState } from 'react'
import type { GameCandidate } from '@shared/types'

interface Row {
  candidate: GameCandidate
  selected: boolean
  name: string
  exe: string
}

interface Props {
  candidates: GameCandidate[]
  onDone: () => void
}

/** Lets the user confirm which custom-folder finds are games, rename them and pick the right exe. */
export function CandidateReview({ candidates, onDone }: Props): React.JSX.Element {
  const [rows, setRows] = useState<Row[]>(() =>
    candidates.map((c) => ({ candidate: c, selected: true, name: c.name, exe: c.executablePath! }))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (i: number, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      const toCandidate = (r: Row): GameCandidate => ({ ...r.candidate, name: r.name, executablePath: r.exe })
      await window.vanity.games.confirmCandidates(
        rows.filter((r) => r.selected).map(toCandidate),
        rows.filter((r) => !r.selected).map((r) => r.candidate)
      )
      onDone()
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
            Untick anything that isn't a game. Unticked items won't be suggested again.
          </p>
        </div>
        <ul className="flex-1 divide-y divide-border overflow-y-auto">
          {rows.map((r, i) => (
            <li key={r.candidate.externalId} className="flex items-center gap-4 px-6 py-3">
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
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-end gap-3 border-t border-border p-4">
          {error && <span className="mr-auto text-sm text-accent">{error}</span>}
          <button className="rounded-lg px-4 py-2 text-sm text-muted hover:text-text" onClick={onDone} disabled={saving}>
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
    </div>
  )
}
