import { useState } from 'react'
import { ArrowRight, Check, Download, Loader2, Sparkles, X } from 'lucide-react'
import type { UpdateState } from '@shared/types'
import { Button, Dialog } from './Dialog'

/** Approve or deny an update, with the patch notes for every version since yours. */
export function UpdateDialog({ state, onClose }: { state: UpdateState; onClose: () => void }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const busy = state.applying !== null

  const approve = async (): Promise<void> => {
    setError(null)
    const res = await window.vanity.update.apply()
    if (res.error !== undefined) setError(res.error)
  }

  return (
    <Dialog
      size="xl"
      title="Update available"
      description={state.available || busy ? `A new version of Vanity is ready to install.` : "You're on the latest version."}
      onClose={() => !busy && onClose()}
    >
      <div className="p-6">
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full bg-white/5 px-3 py-1 font-semibold tabular-nums ring-1 ring-white/10">v{state.current}</span>
          <ArrowRight className="size-4 text-muted" />
          <span className="rounded-full bg-accent/20 px-3 py-1 font-semibold tabular-nums text-text ring-1 ring-accent/40">v{state.latest ?? '?'}</span>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="primary" onClick={approve} disabled={busy || !state.available}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {busy ? state.applying : 'Update and restart'}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            <X className="size-4" /> Not now
          </Button>
        </div>
        {busy && <p className="mt-3 text-xs text-muted">Keep Vanity open. It restarts by itself when the update is installed.</p>}
        {(error ?? state.error) && !busy && <p className="mt-3 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm">{error ?? state.error}</p>}

        <h3 className="mb-3 mt-7 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
          <Sparkles className="size-3.5 text-accent" /> Patch notes
        </h3>
        <div className="space-y-5">
          {state.notes.map((n) => (
            <section key={n.version}>
              <p className="flex items-baseline gap-2">
                <span className="font-display text-base font-bold">v{n.version}</span>
                {n.date && (
                  <span className="text-xs text-muted">
                    {new Date(`${n.date}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                  </span>
                )}
              </p>
              <ul className="mt-2 space-y-1.5">
                {n.changes.map((c, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed text-text/85">
                    <Check className="mt-1 size-3.5 shrink-0 text-emerald-400" />
                    <span className="select-text">{c}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
