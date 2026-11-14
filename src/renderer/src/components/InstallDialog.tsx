import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, FolderOpen, HardDrive, Loader2, TriangleAlert } from 'lucide-react'
import { SOURCE_LABELS, type Game, type InstallPlan } from '@shared/types'
import { formatSize, onOpenInstallDialog } from '@/state/downloads'
import { useToast } from '@/state/toasts'
import { Button, Dialog } from './Dialog'

/** "Install": pick the folder, see how big the game is and whether it fits, then add it to the queue. */
export function InstallDialog(): React.JSX.Element | null {
  const [game, setGame] = useState<Game | null>(null)
  useEffect(() => onOpenInstallDialog(setGame), [])
  return game ? <InstallForm key={game.id} game={game} onClose={() => setGame(null)} /> : null
}

function InstallForm({ game, onClose }: { game: Game; onClose: () => void }): React.JSX.Element {
  const toast = useToast()
  const navigate = useNavigate()
  const [plan, setPlan] = useState<InstallPlan | null>(null)
  const [dir, setDir] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)

  const load = useCallback(
    async (folder?: string) => {
      setLoading(true)
      setError(null)
      const res = await window.vanity.downloads.plan(game.id, folder)
      setLoading(false)
      if (res.error !== undefined) {
        setError(res.error)
        return
      }
      setPlan(res.data)
      setDir(res.data.installDir)
    },
    [game.id]
  )
  useEffect(() => void load(), [load])

  const choose = async (): Promise<void> => {
    const picked = await window.vanity.settings.pickFolder()
    if (picked) await load(picked)
  }

  const start = async (): Promise<void> => {
    if (!dir) return
    setStarting(true)
    const res = await window.vanity.downloads.start(game.id, dir)
    setStarting(false)
    if (res.error !== undefined) {
      setError(res.error)
      return
    }
    toast(`${game.name} added to Downloads`)
    onClose()
    navigate('/downloads')
  }

  const store = SOURCE_LABELS[game.source]
  return (
    <Dialog
      title={`Install ${game.name}`}
      description={`Vanity downloads it from ${store} and installs it for you.`}
      onClose={() => !starting && onClose()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={starting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={start} disabled={starting || loading || !plan || !plan.enoughSpace}>
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Install
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-6">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted">Install folder</p>
          <div className="flex gap-2">
            <p className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-border bg-surface-2 px-4 font-mono text-sm" title={dir}>
              <span className="truncate">{dir ?? '…'}</span>
            </p>
            <Button className="h-11 shrink-0" onClick={choose} disabled={starting}>
              <FolderOpen className="size-4" /> Change
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-muted">The game gets its own folder inside this one. Vanity remembers your choice.</p>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Asking {store} how big it is…
          </p>
        ) : plan ? (
          <>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-xl bg-surface-2 p-3">
                <dt className="text-xs text-muted">Download</dt>
                <dd className="mt-0.5 text-lg font-bold tabular-nums">{formatSize(plan.downloadBytes)}</dd>
              </div>
              <div className="rounded-xl bg-surface-2 p-3">
                <dt className="text-xs text-muted">Installed size</dt>
                <dd className="mt-0.5 text-lg font-bold tabular-nums">{plan.installBytes ? formatSize(plan.installBytes) : 'Not given'}</dd>
              </div>
              <div className="rounded-xl bg-surface-2 p-3">
                <dt className="flex items-center gap-1 text-xs text-muted">
                  <HardDrive className="size-3" /> Free on drive
                </dt>
                <dd className={plan.enoughSpace ? 'mt-0.5 text-lg font-bold tabular-nums' : 'mt-0.5 text-lg font-bold tabular-nums text-accent'}>{plan.freeBytes === null ? 'Unknown' : formatSize(plan.freeBytes)}</dd>
              </div>
            </dl>
            {!plan.enoughSpace && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" /> There isn't enough free space on that drive. Free some up, or choose another folder.
              </p>
            )}
            {game.source === 'gog' && <p className="text-xs text-muted">GOG games come as an installer. When the download finishes, Windows asks once for permission to run it; choose Yes.</p>}
          </>
        ) : null}

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
