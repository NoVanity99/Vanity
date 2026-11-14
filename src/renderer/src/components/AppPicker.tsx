import { useEffect, useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { InstalledApp } from '@shared/ipc'
import { searchKey } from '@/lib/format'
import { mediaUrl, nameHue } from '@/lib/media'
import { useLibrary } from '@/state/library'
import { useToast } from '@/state/toasts'
import { Button, Dialog } from './Dialog'

// Opening from anywhere ("Add a game" on Android).
const openers = new Set<() => void>()
export function openAppPicker(): void {
  for (const fn of openers) fn()
}

/** Android's "Add a game": pick any installed app. (Some games don't tell Android they're games, so the scan misses them.) */
export function AppPicker(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = (): void => setOpen(true)
    openers.add(show)
    return () => {
      openers.delete(show)
    }
  }, [])
  return open ? <Picker onClose={() => setOpen(false)} /> : null
}

function Picker({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { refresh } = useLibrary()
  const toast = useToast()
  const [apps, setApps] = useState<InstalledApp[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    window.vanity.games.installedApps().then(setApps, () => setApps([]))
  }, [])

  const shown = useMemo(() => {
    const q = searchKey(query.trim())
    return (apps ?? []).filter((a) => !q || searchKey(a.name).includes(q))
  }, [apps, query])

  const add = async (app: InstalledApp): Promise<void> => {
    const game = await window.vanity.games.addApp(app.packageName).catch(() => null)
    if (!game) return toast(`Couldn't add ${app.name}.`, 'error')
    setApps((list) => (list ?? []).filter((a) => a.packageName !== app.packageName))
    await refresh()
    toast(`Added ${game.name} to your library`)
  }

  return (
    <Dialog title="Add a game" description="Vanity adds games automatically. If one is missing, pick it from the apps on your phone." onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="p-4">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your apps"
            className="h-10 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-muted focus:border-accent"
          />
        </div>
        {apps === null ? (
          <div className="shimmer h-40 rounded-xl bg-white/[0.03]" />
        ) : shown.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted">{apps.length === 0 ? 'Every app on your phone is already in your library.' : 'No apps match.'}</p>
        ) : (
          <ul className="space-y-1">
            {shown.map((a) => (
              <li key={a.packageName}>
                <button onClick={() => void add(a)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/5">
                  <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl" style={{ background: `hsl(${nameHue(a.name)} 40% 24%)` }}>
                    {a.icon ? <img src={mediaUrl(a.icon)!} alt="" className="size-full object-cover" draggable={false} /> : <span className="font-bold text-white/60">{a.name.charAt(0).toUpperCase()}</span>}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
                  <Plus className="size-4 shrink-0 text-accent" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
