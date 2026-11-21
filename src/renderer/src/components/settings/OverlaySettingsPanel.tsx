import { useState } from 'react'
import { Eye, Layers } from 'lucide-react'
import { OVERLAY_CORNERS, type OverlayCorner, type OverlaySettings } from '@shared/overlay'
import { Button } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import { saveSettings, useSettings } from '@/state/settings'
import { useToast } from '@/state/toasts'

function Switch({ on, onChange, label, hint, name }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string; name: string }): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition', on ? 'bg-accent' : 'bg-white/15')} data-overlay-switch={name}>
        <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
      </button>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  )
}

/** A little screen with four corners to pick from. */
function CornerPicker({ value, onChange, label, disabled, name }: { value: OverlayCorner; onChange: (c: OverlayCorner) => void; label: string; disabled?: boolean; name: string }): React.JSX.Element {
  return (
    <div className={cn(disabled && 'pointer-events-none opacity-45')}>
      <p className="mb-1.5 text-xs font-semibold text-muted">{label}</p>
      <div className="grid h-20 w-36 grid-cols-2 grid-rows-2 gap-1 rounded-lg border border-border bg-black/40 p-1" role="radiogroup" aria-label={label} data-overlay-corner={name}>
        {OVERLAY_CORNERS.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={value === c.id} aria-label={c.label} title={c.label} disabled={disabled} onClick={() => onChange(c.id)} className={cn('flex rounded p-1 transition', c.id.startsWith('top') ? 'items-start' : 'items-end', c.id.endsWith('left') ? 'justify-start' : 'justify-end', value === c.id ? 'bg-accent/20' : 'hover:bg-white/8')} data-corner={c.id}>
            <span className={cn('size-2.5 rounded-full', value === c.id ? 'bg-accent' : 'bg-white/25')} />
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">{OVERLAY_CORNERS.find((c) => c.id === value)?.label}</p>
    </div>
  )
}

/**
 * The in-game overlay's settings: on or off, notifications on or off, and a corner for each.
 * Only on Windows (an Android game covers the whole screen and nothing may be drawn over it).
 */
export function OverlaySettingsPanel(): React.JSX.Element | null {
  const settings = useSettings()
  const toast = useToast()
  const [previewing, setPreviewing] = useState(false)
  if (!window.vanity.overlay.supported || !settings) return null
  const o = settings.overlay
  const save = (patch: Partial<OverlaySettings>): void => void saveSettings({ overlay: { ...o, ...patch } }).catch(() => toast("Couldn't save that.", 'error'))

  return (
    <section className="rounded-2xl border border-border bg-surface p-6" data-overlay-settings>
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Layers className="size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">In-game overlay</h2>
          <p className="text-sm text-muted">While a game started from Vanity is running: who's in your voice room, with a green ring around whoever is talking, and small notifications. It never takes the mouse or keyboard from the game.</p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <Switch name="enabled" on={o.enabled} onChange={(enabled) => save({ enabled })} label="Show the overlay over games" hint="Appears when a game starts and goes away when it closes." />
        <Switch name="notifications" on={o.enabled && o.notifications} onChange={(notifications) => save({ notifications })} label="Notifications over the game" hint="Friend requests, messages, invites and friends coming online, for about 5 seconds each." />
      </div>

      <div className="mt-5 flex flex-wrap gap-8">
        <CornerPicker name="voice" label="Voice pictures" value={o.voiceCorner} onChange={(voiceCorner) => save({ voiceCorner })} disabled={!o.enabled} />
        <CornerPicker name="notifications" label="Notifications" value={o.notificationCorner} onChange={(notificationCorner) => save({ notificationCorner })} disabled={!o.enabled || !o.notifications} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          disabled={!o.enabled || previewing}
          onClick={async () => {
            setPreviewing(true)
            const shown = await window.vanity.overlay.preview().catch(() => false)
            if (!shown) toast("Couldn't show the overlay.", 'error')
            setTimeout(() => setPreviewing(false), 6000)
          }}
          data-overlay-preview
        >
          <Eye className="size-4" /> {previewing ? 'Showing for a few seconds…' : 'Show a preview'}
        </Button>
        <p className="min-w-0 flex-1 text-xs text-muted">Works over games in a window or in borderless full screen. A game in exclusive full screen hides it: switch the game to "borderless" or "windowed full screen" in its video settings.</p>
      </div>
    </section>
  )
}
