import { RotateCcw } from 'lucide-react'
import { SYSTEM_NOTIFICATIONS, CLOCK_STYLES, CORNER_STYLES, COVER_HOVERS, DEFAULT_INTERFACE, NAV_ITEMS, START_PAGES, UI_SCALES, type InterfaceOptions } from '@shared/interfaceOptions'
import { Button } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import { isAndroid } from '@/lib/platform'
import { Section, Toggle } from './controls'

/** A row of choices where one is picked. */
function Choice<T extends string>({ label, hint, value, options, onPick }: { label: string; hint?: string; value: T; options: readonly { id: T; label: string }[]; onPick: (id: T) => void }): React.JSX.Element {
  return (
    <div className="px-3 py-2.5">
      <p className="text-sm">{label}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onPick(o.id)}
            className={cn('rounded-lg border px-3.5 py-2 text-sm transition', value === o.id ? 'border-accent bg-accent/15 font-semibold text-text' : 'border-border text-muted hover:border-white/25 hover:text-text')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Settings → Customize: switch parts of the launcher on and off and change how it feels.
 * Every change applies at once and is kept on this device.
 */
export function CustomizeSettings({ options, onChange }: { options: InterfaceOptions; onChange: (next: InterfaceOptions, note?: string) => void }): React.JSX.Element {
  const android = isAndroid()
  const set = (patch: Partial<InterfaceOptions>): void => onChange({ ...options, ...patch })
  const flag = (key: { [K in keyof InterfaceOptions]: InterfaceOptions[K] extends boolean ? K : never }[keyof InterfaceOptions], label: string, hint?: string): React.JSX.Element => (
    <Toggle checked={options[key]} onChange={(v) => set({ [key]: v })} label={label} hint={hint} />
  )
  const changed = JSON.stringify(options) !== JSON.stringify(DEFAULT_INTERFACE)
  // Entries this device doesn't have at all aren't offered.
  const navItems = NAV_ITEMS.filter((n) => !(android && (n.id === 'store' || n.id === 'downloads')))

  return (
    <>
      <Section title="Start page" description="The page Vanity opens on.">
        <Choice label="Open Vanity on" value={options.startPage} options={START_PAGES} onPick={(startPage) => set({ startPage })} />
      </Section>

      <Section title="Sidebar" description="Choose what's in the menu on the left. Library, Settings and your account always stay. A hidden page can still be opened from search (Ctrl K).">
        <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-widest text-muted">Pages</p>
        <div className="grid grid-cols-2 gap-x-4 max-md:grid-cols-1">
          {navItems.map((n) => (
            <Toggle
              key={n.id}
              checked={!options.hiddenNav.includes(n.id)}
              onChange={(show) => set({ hiddenNav: show ? options.hiddenNav.filter((id) => id !== n.id) : [...options.hiddenNav, n.id] })}
              label={n.label}
            />
          ))}
        </div>
        <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-widest text-muted">Extras</p>
        {flag('sidebarLevel', 'Level and XP', 'Your level ring at the top.')}
        {flag('sidebarSearch', 'Search box')}
        {flag('sidebarCollections', 'Collections')}
        {flag('sidebarCounts', 'Game counts', 'The numbers next to Library, Favorites and collections.')}
        {!android && (
          <>
            <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-widest text-muted">Size</p>
            {flag('sidebarCollapsed', 'Hide the sidebar', 'Also the small button at the top of the sidebar. A button in the top-left corner brings it back.')}
            <Choice
              label="Width"
              hint={`You can also drag the sidebar's right edge. Now ${options.sidebarWidth} px.`}
              value={options.sidebarWidth <= 225 ? 'narrow' : options.sidebarWidth >= 300 ? 'wide' : options.sidebarWidth === 240 ? 'normal' : 'custom'}
              options={[
                { id: 'narrow', label: 'Narrow' },
                { id: 'normal', label: 'Normal' },
                { id: 'wide', label: 'Wide' }
              ]}
              onPick={(w) => set({ sidebarWidth: w === 'narrow' ? 220 : w === 'wide' ? 320 : 240 })}
            />
          </>
        )}
      </Section>

      <Section title="Top bar" description="The strip along the top of the window.">
        {!android && flag('launcherStatusBar', 'Launcher status', 'The dots showing whether Steam, Epic and the others are up.')}
        {flag('musicPlayer', 'Music player')}
        <Choice label="Clock" value={options.clock} options={CLOCK_STYLES} onPick={(clock) => set({ clock })} />
      </Section>

      <Section title="Library" description="What the Library page shows.">
        {flag('jumpBackIn', 'Jump back in', 'The row of your three most recent games.')}
        {flag('playerCounts', 'Player counts on covers')}
        {flag('statusBadges', 'Favourite stars and status labels on covers')}
        {flag('gameNames', 'Game names under covers')}
        {flag('vibeCheckButton', 'Vibe Check button')}
        {flag('surpriseButton', 'Surprise me button')}
        {!android && <Choice label="When the mouse is over a cover" value={options.coverHover} options={COVER_HOVERS} onPick={(coverHover) => set({ coverHover })} />}
      </Section>

      <Section title="Friend notifications" description={`A card in the corner of Vanity, and a ${android ? 'phone' : 'Windows'} notification, when a friend does one of these.`}>
        {flag('notifyFriendOnline', 'A friend comes online')}
        {flag('notifyFriendPlaying', 'A friend starts a game', 'With the name of the game.')}
        {flag('notifyFriendMessage', 'A friend sends you a message', 'With what they wrote.')}
        {flag('notifyGroupMessage', 'Someone writes in a group chat', 'With who wrote and what.')}
        <Choice label={android ? 'Phone notifications' : 'Windows notifications'} hint="Besides the card inside Vanity." value={options.systemNotifications} options={SYSTEM_NOTIFICATIONS} onPick={(systemNotifications) => set({ systemNotifications })} />
      </Section>

      <Section title="Look and feel" description="Size, shape and movement, everywhere in Vanity.">
        <Choice label="Interface size" hint="Makes everything smaller or bigger." value={options.scale} options={UI_SCALES} onPick={(scale) => set({ scale })} />
        <Choice label="Corners" value={options.corners} options={CORNER_STYLES} onPick={(corners) => set({ corners })} />
        {flag('animations', 'Animations', 'Off: pages and cards appear at once, and the Trending row stops drifting.')}
        {flag('toasts', 'Small confirmations', 'The little messages in the corner, like "Signed in". Problems always show.')}
        <div className="mt-4 flex items-center gap-3 border-t border-border px-3 pt-4">
          <p className="flex-1 text-xs text-muted">These settings are kept on this device.</p>
          <Button onClick={() => onChange(DEFAULT_INTERFACE, 'Customize settings reset')} disabled={!changed}>
            <RotateCcw className="size-4" /> Reset to defaults
          </Button>
        </div>
      </Section>
    </>
  )
}
