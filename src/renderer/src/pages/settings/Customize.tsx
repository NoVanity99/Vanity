import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react'
import type { Settings } from '@shared/types'
import { BANNERS, DEFAULT_PROFILE, EFFECTS, FLAIRS, FRAMES, NAME_STYLES, sanitizeProfile, type ProfileOption, type ProfileStyle } from '@shared/profile'
import { DEFAULT_UI, NAV_MODULES, sanitizeUi, type UiPrefs } from '@shared/ui'
import { Avatar } from '@/components/Avatar'
import { ProfileCard } from '@/components/ProfileCard'
import { Button } from '@/components/Dialog'
import { useToast } from '@/state/toasts'
import { useAccount } from '@/state/account'
import { cn } from '@/lib/cn'

type Save = (patch: Partial<Settings>, confirmation?: string) => Promise<void>

function Heading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h3 className="mb-3 mt-6 text-sm font-semibold text-muted first:mt-0">{children}</h3>
}

/** A row of pill buttons to pick one option. */
function Choice<T extends string>({ options, value, onChange }: { options: { id: T; name: string }[]; value: T; onChange: (v: T) => void }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded-full border px-3.5 py-1.5 text-sm transition',
            value === o.id ? 'border-accent bg-accent/15 text-text' : 'border-border bg-surface-2 text-muted hover:border-white/25 hover:text-text'
          )}
        >
          {o.name}
        </button>
      ))}
    </div>
  )
}

function Switch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-white/5">
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span className={cn('relative block h-6 w-11 shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-accent' : 'bg-white/15')}>
        <span className={cn('absolute left-0 top-1 size-4 rounded-full bg-white shadow transition-transform duration-200', checked ? 'translate-x-6' : 'translate-x-1')} />
      </span>
    </button>
  )
}

/**
 * Your profile's look: a live preview on top, then banner, frame, name style, effect, flair and
 * tagline. It's saved to your account, so it follows you to every device and your friends see it.
 */
export function ProfileSettings(): React.JSX.Element {
  const account = useAccount()
  const toast = useToast()
  const navigate = useNavigate()
  // Shown straight away while the save is on its way; the account's answer then replaces it.
  const [pending, setPending] = useState<ProfileStyle | null>(null)
  if (!account?.signedIn || !account.username) {
    return (
      <div className="rounded-xl border border-border bg-surface-2/60 p-5 text-sm">
        <p>Sign in to your Vanity account to style your profile. Your friends see the look next to your name.</p>
        <Button variant="primary" className="mt-4" onClick={() => navigate('/account')}>
          Go to Account
        </Button>
      </div>
    )
  }
  const profile = sanitizeProfile(pending ?? account.style)
  const name = account.username
  const set = (patch: Partial<ProfileStyle>, done?: string): void => {
    const next = { ...profile, ...patch }
    setPending(next)
    void window.vanity.account
      .setProfile({ style: next })
      .then((res) => {
        if (res.error !== undefined) toast(res.error, 'error')
        else if (done) toast(done)
      })
      .catch(() => toast('Could not save your profile look.', 'error'))
      .finally(() => setPending((current) => (current === next ? null : current)))
  }

  const swatches = (options: ProfileOption[], kind: 'banner' | 'effect', value: string): React.JSX.Element => (
    <div className="grid grid-cols-4 gap-2.5 max-md:grid-cols-2">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => set({ [kind]: o.id })}
          className={cn('overflow-hidden rounded-xl border text-left transition', value === o.id ? 'border-accent ring-2 ring-accent/40' : 'border-border hover:border-white/25')}
        >
          <div className="profile-banner h-12" data-banner={kind === 'banner' ? o.id : profile.banner}>
            {kind === 'effect' && <div className="profile-effect" data-effect={o.id} />}
          </div>
          <div className="truncate px-2.5 py-1.5 text-xs">{o.name}</div>
        </button>
      ))}
    </div>
  )

  return (
    <div>
      <ProfileCard name={name} avatar={account.avatar} style={profile} status="online" verified={account.verified} admin={account.admin}>
        <p className="text-xs text-muted">This is how your friends see you. Your picture and bio are on the Account page.</p>
      </ProfileCard>

      <Heading>Banner</Heading>
      {swatches(BANNERS, 'banner', profile.banner)}

      <Heading>Picture frame</Heading>
      <div className="flex flex-wrap gap-3">
        {FRAMES.map((f) => (
          <button
            key={f.id}
            onClick={() => set({ frame: f.id })}
            title={f.name}
            className={cn('flex w-[5.5rem] flex-col items-center gap-2 rounded-xl border px-2 py-3 transition', profile.frame === f.id ? 'border-accent bg-accent/10' : 'border-border hover:border-white/25')}
          >
            <Avatar name={name} src={account.avatar} frame={f.id} />
            <span className="truncate text-[11px] text-muted">{f.name}</span>
          </button>
        ))}
      </div>

      <Heading>Name style</Heading>
      <div className="flex flex-wrap gap-2">
        {NAME_STYLES.map((n) => (
          <button
            key={n.id}
            onClick={() => set({ nameStyle: n.id })}
            className={cn('rounded-xl border px-4 py-2 text-base font-bold transition', profile.nameStyle === n.id ? 'border-accent bg-accent/10' : 'border-border bg-surface-2 hover:border-white/25')}
          >
            <span className="profile-name" data-name={n.id}>
              {n.name}
            </span>
          </button>
        ))}
      </div>

      <Heading>Effect</Heading>
      {swatches(EFFECTS, 'effect', profile.effect)}

      <Heading>Flair</Heading>
      <div className="flex flex-wrap gap-1.5">
        {FLAIRS.map((f) => (
          <button
            key={f || 'none'}
            onClick={() => set({ flair: f })}
            className={cn('flex size-10 items-center justify-center rounded-lg border text-lg transition', profile.flair === f ? 'border-accent bg-accent/15' : 'border-border bg-surface-2 hover:border-white/25')}
          >
            {f || <span className="text-xs text-muted">None</span>}
          </button>
        ))}
      </div>

      <Heading>Tagline</Heading>
      <input
        defaultValue={profile.tagline}
        key={profile.tagline}
        maxLength={60}
        placeholder="A line under your name (optional)"
        onBlur={(e) => e.target.value.trim() !== profile.tagline && set({ tagline: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none transition placeholder:text-muted focus:border-accent"
      />

      <button onClick={() => set(DEFAULT_PROFILE, 'Profile look reset')} className="mt-5 flex items-center gap-2 text-xs text-muted transition hover:text-text">
        <RotateCcw className="size-3.5" /> Reset my profile look
      </button>
    </div>
  )
}

/** Launcher options: colour, shape, size, background, covers, the sidebar's modules and the start page. */
export function CustomizeSettings({ settings, save }: { settings: Settings; save: Save }): React.JSX.Element {
  const ui = sanitizeUi(settings.ui)
  const set = (patch: Partial<UiPrefs>): void => void save({ ui: { ...ui, ...patch } })
  // Sidebar entries in the user's order, hidden ones included (so they can be switched back on).
  const order = [...NAV_MODULES].sort((a, b) => {
    const rank = (p: string): number => (ui.navOrder.indexOf(p) === -1 ? ui.navOrder.length + NAV_MODULES.findIndex((m) => m.path === p) : ui.navOrder.indexOf(p))
    return rank(a.path) - rank(b.path)
  })
  const move = (index: number, by: number): void => {
    const next = order.map((m) => m.path)
    const to = index + by
    if (to < 0 || to >= next.length) return
    ;[next[index], next[to]] = [next[to], next[index]]
    set({ navOrder: next })
  }
  const toggleNav = (path: string): void => set({ hiddenNav: ui.hiddenNav.includes(path) ? ui.hiddenNav.filter((p) => p !== path) : [...ui.hiddenNav, path] })

  return (
    <div>
      <Heading>Accent colour</Heading>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => set({ accent: '' })} className={cn('rounded-full border px-3.5 py-1.5 text-sm transition', !ui.accent ? 'border-accent bg-accent/15' : 'border-border bg-surface-2 text-muted hover:text-text')}>
          From the skin
        </button>
        {['#ff4747', '#f97316', '#f5c33b', '#22c55e', '#14b8a6', '#3b9eff', '#6366f1', '#a855f7', '#ff2bd6'].map((c) => (
          <button
            key={c}
            aria-label={`Accent ${c}`}
            onClick={() => set({ accent: c })}
            className={cn('size-8 rounded-full border-2 transition hover:scale-110', ui.accent === c ? 'border-white' : 'border-transparent')}
            style={{ background: c }}
          />
        ))}
        <label className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 text-sm text-muted hover:text-text">
          Custom
          <input type="color" value={ui.accent || '#ff4747'} onChange={(e) => set({ accent: e.target.value })} className="size-6 cursor-pointer rounded border-0 bg-transparent p-0" />
        </label>
      </div>

      <Heading>Corners</Heading>
      <Choice options={[{ id: 'sharp', name: 'Sharp' }, { id: 'soft', name: 'Soft' }, { id: 'round', name: 'Round' }]} value={ui.corners} onChange={(corners) => set({ corners })} />

      <Heading>Size of everything: {ui.scale}%</Heading>
      <input type="range" min={85} max={125} step={5} value={ui.scale} onChange={(e) => set({ scale: Number(e.target.value) })} className="w-full accent-[var(--color-accent)]" />

      <Heading>Background</Heading>
      <Choice
        options={[{ id: 'glow', name: 'Soft glow' }, { id: 'aurora', name: 'Aurora' }, { id: 'grid', name: 'Cyber grid' }, { id: 'stars', name: 'Starfield' }, { id: 'none', name: 'Plain' }]}
        value={settings.ambientBackground === false ? 'none' : ui.background}
        onChange={(background) => void save({ ambientBackground: background !== 'none', ui: { ...ui, background } })}
      />

      <Heading>Game covers, when you point at them</Heading>
      <Choice
        options={[{ id: 'lift', name: 'Lift' }, { id: 'zoom', name: 'Zoom' }, { id: 'glow', name: 'Glow' }, { id: 'tilt', name: '3D tilt' }, { id: 'none', name: 'Stay still' }]}
        value={ui.cardHover}
        onChange={(cardHover) => set({ cardHover })}
      />

      <Heading>Opens on</Heading>
      <Choice
        options={[{ id: 'library', name: 'Library' }, { id: 'trending', name: 'Trending' }, { id: 'recent', name: 'Recently Played' }, { id: 'favorites', name: 'Favorites' }, { id: 'stats', name: 'Stats' }, { id: 'friends', name: 'Friends' }]}
        value={ui.startPage}
        onChange={(startPage) => set({ startPage })}
      />

      <Heading>Sidebar: what's in it, and in what order</Heading>
      <div className="space-y-1.5">
        {order.map((m, i) => {
          const on = !ui.hiddenNav.includes(m.path)
          const fixed = m.path === '/library'
          return (
            <div key={m.path} className={cn('flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm', !on && 'opacity-50')}>
              <span className="flex-1">{m.label}</span>
              <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${m.label} up`} className="rounded p-1 text-muted transition hover:bg-white/10 hover:text-text disabled:opacity-30">
                <ArrowUp className="size-4" />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${m.label} down`} className="rounded p-1 text-muted transition hover:bg-white/10 hover:text-text disabled:opacity-30">
                <ArrowDown className="size-4" />
              </button>
              <button
                onClick={() => !fixed && toggleNav(m.path)}
                disabled={fixed}
                className={cn('w-16 rounded-full px-2 py-1 text-xs font-medium transition', on ? 'bg-accent/20 text-text' : 'bg-white/10 text-muted', fixed && 'cursor-default opacity-60')}
              >
                {fixed ? 'Always' : on ? 'Shown' : 'Hidden'}
              </button>
            </div>
          )
        })}
      </div>

      <div className="-mx-3 mt-5 border-t border-border pt-3">
        <Switch label="Compact sidebar" hint="Icons only, for more room" checked={ui.compactSidebar} onChange={(compactSidebar) => set({ compactSidebar })} />
        <Switch label="Level and XP in the sidebar" checked={ui.showLevel} onChange={(showLevel) => set({ showLevel })} />
        <Switch label="Search button in the sidebar" hint="Ctrl+K still works when it's hidden" checked={ui.showSearch} onChange={(showSearch) => set({ showSearch })} />
        <Switch label="Collections in the sidebar" checked={ui.showCollections} onChange={(showCollections) => set({ showCollections })} />
        <Switch label="Music player at the top" checked={ui.showMusicPlayer} onChange={(showMusicPlayer) => set({ showMusicPlayer })} />
        <Switch label="Launcher status at the top" checked={ui.showLauncherStatus} onChange={(showLauncherStatus) => set({ showLauncherStatus })} />
        <Switch label="See-through panels" hint="Turn off for solid panels" checked={ui.glass} onChange={(glass) => set({ glass })} />
        <Switch label="Reduce motion" hint="Turns most animations off" checked={ui.reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} />
      </div>

      <button onClick={() => void save({ ui: DEFAULT_UI, ambientBackground: true }, 'Launcher options reset')} className="mt-4 flex items-center gap-2 text-xs text-muted transition hover:text-text">
        <RotateCcw className="size-3.5" /> Reset these options
      </button>
    </div>
  )
}
