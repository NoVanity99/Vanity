import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Ban as BanIcon, Check, Copy, Crown, FolderPlus, Hash, Link2, Loader2, Lock, LogOut, Megaphone, Pencil, Plus, ShieldCheck, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { can, LIMITS, rankOf, ROLE_COLORS, ROLES, tidyName, VISIBILITIES, type Ban, type Channel, type CommunityDetail, type CommunityMember, type CustomRole, type Invite, type JoinRequest, type Restriction, type Role, type Visibility } from '@shared/communities'
import type { ProfileStyle } from '@shared/profileStyle'
import { Avatar } from '@/components/Avatar'
import { Button, Dialog } from '@/components/Dialog'
import { UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { formatAgo } from '@/lib/format'
import { api, refreshCommunities } from '@/state/communities'
import { useFriends } from '@/state/friends'
import { useToast } from '@/state/toasts'
import { BannerPicker, IconPicker, VISIBILITY_ICON } from './bits'

type Section = 'overview' | 'rooms' | 'roles' | 'members' | 'invites' | 'requests' | 'bans'
const field = 'h-10 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15'
const styleOf = (s: unknown): Partial<ProfileStyle> | undefined => (s && typeof s === 'object' ? (s as Partial<ProfileStyle>) : undefined)
const label = 'mb-1.5 block text-xs font-semibold uppercase tracking-widest text-muted'

/** What each built-in role may do, in words. */
const ROLE_NOTES: Record<Role, string> = {
  owner: 'Everything, including who can find the Channel, handing it over and deleting it.',
  admin: 'Change the name, picture and banner; manage channels and categories; give roles below Admin; kick and ban; delete messages; invite; approve requests.',
  mod: 'Kick members, delete messages, invite people and approve join requests.',
  member: 'Read and write in every channel.'
}

/**
 * A community's settings (what people see as "Channel Settings"). Each part only shows to the
 * roles that may use it, and the server checks every action again.
 */
export function CommunitySettings({ community: c, myId, initial, onClose, onChanged, onGone }: { community: CommunityDetail; myId: string | undefined; initial?: 'invites' | 'requests'; onClose: () => void; onChanged: () => Promise<void> | void; onGone: () => void }): React.JSX.Element {
  const toast = useToast()
  const role = c.role!
  const [section, setSection] = useState<Section>(initial ?? (can(role, 'manageCommunity') ? 'overview' : 'members'))
  const [busy, setBusy] = useState(false)
  const [members, setMembers] = useState<CommunityMember[] | null>(null)
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [requests, setRequests] = useState<JoinRequest[] | null>(null)
  const [bans, setBans] = useState<Ban[] | null>(null)
  const [confirm, setConfirm] = useState<null | { title: string; text: string; action: string; run: () => Promise<void> }>(null)

  // Overview drafts.
  const [name, setName] = useState(c.name)
  const [description, setDescription] = useState(c.description)
  // New things.
  const [newChannel, setNewChannel] = useState<{ name: string; categoryId: string | null } | null>(null)
  const [newCategory, setNewCategory] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ kind: 'channel' | 'category'; id: string; name: string } | null>(null)
  const [inviteHours, setInviteHours] = useState<number | null>(24 * 7)
  const [inviteUses, setInviteUses] = useState<number | null>(null)
  const [transferTo, setTransferTo] = useState('')
  // Custom roles, who a channel is for, and friends invited straight in.
  const [roleDraft, setRoleDraft] = useState<{ id: string | null; name: string; color: string } | null>(null)
  const [access, setAccess] = useState<{ channel: Channel; restricted: Restriction; roleIds: string[] } | null>(null)
  const [invited, setInvited] = useState<string[]>([])
  const friends = useFriends()

  const load = useCallback(async () => {
    try {
      if (section === 'members' || section === 'overview' || section === 'invites') setMembers((await api<{ members: CommunityMember[] }>('GET', `/${c.id}/members`)).members)
      if (section === 'invites') {
        setInvites((await api<{ invites: Invite[] }>('GET', `/${c.id}/invites`)).invites)
        setInvited((await api<{ invited: string[] }>('GET', `/${c.id}/direct-invites`)).invited)
      }
      if (section === 'requests') setRequests((await api<{ requests: JoinRequest[] }>('GET', `/${c.id}/requests`)).requests)
      if (section === 'bans') setBans((await api<{ bans: Ban[] }>('GET', `/${c.id}/bans`)).bans)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not load.', 'error')
    }
  }, [section, c.id, toast])
  useEffect(() => void load(), [load])

  /** Does one thing, says so, and shows the result. */
  const run = async (done: string | null, fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    try {
      await fn()
      if (done) toast(done)
      await onChanged()
      await load()
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work.', 'error')
      return false
    } finally {
      setBusy(false)
    }
  }
  const patch = (body: Record<string, unknown>, done: string | null = 'Saved'): Promise<boolean> => run(done, () => api('PATCH', `/${c.id}`, body).then(() => refreshCommunities()))

  // The channels in the order they're shown, category by category, to move one up or down.
  const ordered = [...c.categories].sort((a, b) => a.position - b.position)
  const inCategory = (categoryId: string | null) => c.channels.filter((ch) => ch.categoryId === categoryId).sort((a, b) => a.position - b.position)
  const layout = (change: (cats: { id: string; channels: string[] }[], loose: string[]) => void): Promise<boolean> => {
    const cats = ordered.map((cat) => ({ id: cat.id, channels: inCategory(cat.id).map((ch) => ch.id) }))
    const loose = inCategory(null).map((ch) => ch.id)
    change(cats, loose)
    return run(null, () => api('PUT', `/${c.id}/layout`, { categories: cats, uncategorized: loose }))
  }
  const move = <T,>(list: T[], i: number, by: number): void => {
    const j = i + by
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
  }

  const sections: { id: Section; label: string; show: boolean; count?: number }[] = [
    { id: 'overview', label: 'Overview', show: can(role, 'manageCommunity') },
    { id: 'rooms', label: 'Channels', show: can(role, 'manageChannels') },
    { id: 'roles', label: 'Roles', show: true },
    { id: 'members', label: 'Members', show: true, count: c.members },
    { id: 'invites', label: 'Invites', show: can(role, 'invite') },
    { id: 'requests', label: 'Join Requests', show: can(role, 'approveRequests'), count: c.pendingRequests || undefined },
    { id: 'bans', label: 'Bans', show: can(role, 'ban') }
  ]
  const iconButton = 'rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-text disabled:opacity-30'
  const empty = (text: string): React.JSX.Element => <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{text}</p>
  const person = (u: { username: string; avatar: string | null; style: unknown; verified: boolean; admin: boolean }, extra?: React.ReactNode): React.JSX.Element => (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <Avatar name={u.username} src={u.avatar} frame={styleOf(u.style)?.frame} size="sm" />
      <span className="min-w-0">
        <UserName name={u.username} style={styleOf(u.style)} verified={u.verified} admin={u.admin} className="text-sm font-semibold" />
        {extra}
      </span>
    </span>
  )

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-[fade-in_150ms_ease-out] items-center justify-center bg-black/70 p-6 backdrop-blur-md max-md:p-2" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-community-settings={section}>
      <div role="dialog" aria-label="Channel settings" className="flex h-[min(44rem,100%)] w-full max-w-4xl animate-[dialog-in_200ms_ease-out] overflow-hidden rounded-3xl border border-white/10 bg-surface shadow-2xl shadow-black/60 max-md:flex-col">
        <nav className="thin-scroll w-52 shrink-0 overflow-y-auto border-r border-border bg-surface-2/50 p-3 max-md:flex max-md:w-full max-md:gap-1 max-md:overflow-x-auto max-md:border-b max-md:border-r-0">
          <p className="mb-2 truncate px-2 text-[11px] font-bold uppercase tracking-widest text-muted max-md:hidden">{c.name}</p>
          {sections.filter((s) => s.show).map((s) => (
            <button key={s.id} onClick={() => setSection(s.id)} className={cn('flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-semibold transition', section === s.id ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'text-muted hover:bg-white/5 hover:text-text')} data-settings-section={s.id}>
              {s.label}
              {s.count !== undefined && <span className={cn('rounded-full px-1.5 text-[10px] font-bold tabular-nums', section === s.id ? 'bg-white/25' : s.id === 'requests' ? 'bg-amber-400 text-black' : 'bg-white/10')}>{s.count}</span>}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
            <h2 className="font-display text-lg font-bold">{sections.find((s) => s.id === section)?.label}</h2>
            {busy && <Loader2 className="size-4 animate-spin text-muted" />}
            <button onClick={onClose} aria-label="Close" className="ml-auto rounded-lg p-1.5 text-muted transition hover:bg-white/8 hover:text-text" data-settings-close>
              <X className="size-5" />
            </button>
          </header>

          <div key={section} className="pane-in thin-scroll min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
            {section === 'overview' && (
              <>
                <IconPicker name={c.name} icon={c.icon} onChange={(icon) => void patch({ icon }, icon ? 'Picture changed' : 'Picture removed')} />
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void patch({ name, description })
                  }}
                >
                  <div>
                    <label className={label} htmlFor="settings-name">Name</label>
                    <input id="settings-name" className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.communityName * 2} data-settings-name />
                  </div>
                  <div>
                    <label className={label} htmlFor="settings-description">Description</label>
                    <textarea id="settings-description" className={cn(field, 'h-auto resize-none py-2.5')} rows={2} value={description} onChange={(e) => setDescription([...e.target.value].slice(0, LIMITS.description).join(''))} />
                  </div>
                  <Button type="submit" variant="primary" disabled={busy || [...tidyName(name, LIMITS.communityName)].length < 2 || (tidyName(name, LIMITS.communityName) === c.name && tidyName(description, LIMITS.description) === c.description)} data-settings-save>
                    <Check className="size-4" /> Save
                  </Button>
                </form>
                <div>
                  <p className={label}>Banner</p>
                  <BannerPicker value={c.banner} onChange={(banner) => void patch({ banner }, null)} />
                </div>
                <div>
                  <p className={label}>Who can find it {role !== 'owner' && <span className="font-normal normal-case tracking-normal">(only the owner can change this)</span>}</p>
                  <div className="grid gap-2" role="radiogroup" aria-label="Who can find it">
                    {VISIBILITIES.map((v) => {
                      const Icon = VISIBILITY_ICON[v.id]
                      return (
                        <button key={v.id} role="radio" aria-checked={c.visibility === v.id} disabled={role !== 'owner' || busy} onClick={() => c.visibility !== v.id && void patch({ visibility: v.id as Visibility }, `Now ${v.label}`)} className={cn('flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition disabled:cursor-not-allowed', c.visibility === v.id ? 'border-accent bg-accent/10 ring-2 ring-accent/30' : 'border-border enabled:hover:border-white/25 disabled:opacity-50')} data-settings-visibility={v.id}>
                          <Icon className={cn('size-4 shrink-0', c.visibility === v.id ? 'text-accent' : 'text-muted')} />
                          <span className="min-w-0">
                            <span className="block text-sm font-bold">{v.label}</span>
                            <span className="block text-xs text-muted">{v.hint}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                {role === 'owner' && (
                  <div className="space-y-3 rounded-2xl border border-accent/30 bg-accent/5 p-4" data-danger-zone>
                    <p className="text-xs font-bold uppercase tracking-widest text-accent">Owner only</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <select className={cn(field, 'w-auto min-w-48 flex-1')} value={transferTo} onChange={(e) => setTransferTo(e.target.value)} aria-label="Hand it to" data-transfer-to>
                        <option value="">Hand this Channel to…</option>
                        {(members ?? []).filter((m) => m.user.id !== myId).map((m) => (
                          <option key={m.user.id} value={m.user.id}>
                            {m.user.username} ({ROLES.find((r) => r.id === m.role)?.label})
                          </option>
                        ))}
                      </select>
                      <Button disabled={!transferTo || busy} onClick={() => setConfirm({ title: 'Hand this Channel over?', text: `${members?.find((m) => m.user.id === transferTo)?.user.username} becomes the Owner and you become an Admin. Only they can give it back.`, action: 'Hand it over', run: async () => void (await run('Handed over', () => api('POST', `/${c.id}/transfer`, { userId: transferTo }))) })} data-transfer>
                        <Crown className="size-4" /> Transfer ownership
                      </Button>
                    </div>
                    <Button className="border-accent/40 text-accent hover:bg-accent/15" disabled={busy} onClick={() => setConfirm({ title: `Delete ${c.name}?`, text: 'Its channels, messages and members are removed for everyone, for good. This cannot be undone.', action: 'Delete for good', run: async () => { await api('DELETE', `/${c.id}`); await refreshCommunities(); toast(`${c.name} was deleted`); onGone() } })} data-delete-community>
                      <Trash2 className="size-4" /> Delete this Channel
                    </Button>
                  </div>
                )}
              </>
            )}

            {section === 'rooms' && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => setNewChannel({ name: '', categoryId: ordered[0]?.id ?? null })} data-add-channel>
                    <Plus className="size-4" /> New channel
                  </Button>
                  <Button onClick={() => setNewCategory('')} data-add-category>
                    <FolderPlus className="size-4" /> New category
                  </Button>
                </div>
                {c.channels.length === 0 && ordered.length === 0 && empty('No channels yet. Create one to start talking.')}
                {[...(inCategory(null).length ? [{ id: null as string | null, name: 'No category' }] : []), ...ordered].map((cat, ci, all) => (
                  <div key={cat.id ?? 'none'} className="rounded-2xl border border-border bg-surface-2/40" data-settings-category={cat.name}>
                    <div className="flex items-center gap-1 border-b border-border px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-widest text-muted">{cat.name}</span>
                      {cat.id && (
                        <>
                          <button className={iconButton} disabled={busy || ci === (inCategory(null).length ? 1 : 0)} title="Move up" onClick={() => void layout((cats) => move(cats, cats.findIndex((x) => x.id === cat.id), -1))}><ArrowUp className="size-3.5" /></button>
                          <button className={iconButton} disabled={busy || ci === all.length - 1} title="Move down" onClick={() => void layout((cats) => move(cats, cats.findIndex((x) => x.id === cat.id), 1))}><ArrowDown className="size-3.5" /></button>
                          <button className={iconButton} title="Rename" onClick={() => setRenaming({ kind: 'category', id: cat.id!, name: cat.name })}><Pencil className="size-3.5" /></button>
                          <button className={cn(iconButton, 'hover:text-accent')} title="Delete the category (its channels stay)" onClick={() => setConfirm({ title: `Delete the category “${cat.name}”?`, text: 'Its channels stay, without a category.', action: 'Delete category', run: async () => void (await run('Category deleted', () => api('DELETE', `/categories/${cat.id}`))) })}><Trash2 className="size-3.5" /></button>
                        </>
                      )}
                    </div>
                    {inCategory(cat.id).length === 0 ? <p className="px-4 py-3 text-xs text-muted">No channels here yet.</p> : inCategory(cat.id).map((ch, i, list) => (
                      <div key={ch.id} className="flex items-center gap-1 px-3 py-1.5 transition hover:bg-white/[0.03]" data-settings-channel={ch.name}>
                        {ch.restricted === 'view' ? <Lock className="size-4 shrink-0 text-amber-300" /> : ch.restricted === 'post' ? <Megaphone className="size-4 shrink-0 text-amber-300" /> : <Hash className="size-4 shrink-0 text-muted" />}
                        <span className="min-w-0 flex-1 truncate text-sm">{ch.name}</span>
                        <button className={cn(iconButton, ch.restricted !== 'none' && 'text-amber-300')} title="Who this channel is for" onClick={() => setAccess({ channel: ch, restricted: ch.restricted, roleIds: ch.roleIds })} data-channel-access><Lock className="size-3.5" /></button>
                        <button className={iconButton} disabled={busy || i === 0} title="Move up" onClick={() => void layout((cats, loose) => move(cat.id ? cats.find((x) => x.id === cat.id)!.channels : loose, i, -1))} data-channel-up><ArrowUp className="size-3.5" /></button>
                        <button className={iconButton} disabled={busy || i === list.length - 1} title="Move down" onClick={() => void layout((cats, loose) => move(cat.id ? cats.find((x) => x.id === cat.id)!.channels : loose, i, 1))} data-channel-down><ArrowDown className="size-3.5" /></button>
                        <select className="h-7 max-w-28 rounded-md border border-border bg-surface-2 px-1 text-[11px] text-muted" aria-label="Category" value={ch.categoryId ?? ''} disabled={busy} onChange={(e) => void layout((cats, loose) => {
                          for (const x of cats) x.channels = x.channels.filter((id) => id !== ch.id)
                          const at = loose.indexOf(ch.id)
                          if (at >= 0) loose.splice(at, 1)
                          const to = cats.find((x) => x.id === e.target.value)
                          if (to) to.channels.push(ch.id)
                          else loose.push(ch.id)
                        })}>
                          <option value="">No category</option>
                          {ordered.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        <button className={iconButton} title="Rename" onClick={() => setRenaming({ kind: 'channel', id: ch.id, name: ch.name })} data-rename-channel><Pencil className="size-3.5" /></button>
                        <button className={cn(iconButton, 'hover:text-accent')} title="Delete" onClick={() => setConfirm({ title: `Delete the channel “${ch.name}”?`, text: 'Every message in it is deleted for everyone. This cannot be undone.', action: 'Delete channel', run: async () => void (await run('Channel deleted', () => api('DELETE', `/channels/${ch.id}`))) })} data-delete-channel><Trash2 className="size-3.5" /></button>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}

            {section === 'roles' && (
              <div className="space-y-2">
                {ROLES.map((r) => (
                  <div key={r.id} className="flex gap-3 rounded-2xl border border-border bg-surface-2/40 p-4" data-role-card={r.id}>
                    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', r.id === 'owner' ? 'bg-amber-400/20 text-amber-300' : r.id === 'admin' ? 'bg-accent/20 text-accent' : r.id === 'mod' ? 'bg-sky-400/20 text-sky-300' : 'bg-white/8 text-muted')}>
                      {r.id === 'owner' ? <Crown className="size-4" /> : r.id === 'member' ? <Users className="size-4" /> : <ShieldCheck className="size-4" />}
                    </span>
                    <span>
                      <span className="block text-sm font-bold">{r.label}{r.id === role && <span className="ml-2 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">You</span>}</span>
                      <span className="block text-xs text-muted">{ROLE_NOTES[r.id]}</span>
                    </span>
                  </div>
                ))}
                <p className="text-xs text-muted">Give someone a role in Members. Nobody can change the role of someone at their own level or above.</p>

                <div className="flex items-center gap-3 pt-4">
                  <h3 className="flex-1 text-xs font-bold uppercase tracking-widest text-muted">Custom roles · {c.roles.length}</h3>
                  {role === 'owner' && (
                    <Button variant="primary" disabled={c.roles.length >= LIMITS.customRoles} onClick={() => setRoleDraft({ id: null, name: '', color: ROLE_COLORS[c.roles.length % ROLE_COLORS.length] })} data-add-role>
                      <Plus className="size-4" /> New role
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted">A custom role is a name and a colour. It colours the person&apos;s name in chat, and lets them into channels you restrict to it (Channels → the lock button). {role !== 'owner' && 'Only the owner can create or change them.'}</p>
                {c.roles.length === 0 ? empty(role === 'owner' ? 'No custom roles yet. Make one, like “VIP” or “Streamer”.' : 'No custom roles yet.') : (
                  <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border" data-custom-roles>
                    {c.roles.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 bg-surface-2/40 px-4 py-2.5" data-custom-role={r.name}>
                        <span className="size-3.5 shrink-0 rounded-full shadow-[0_0_8px]" style={{ background: r.color, color: r.color }} />
                        <span className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color: r.color }}>{r.name}</span>
                        {role === 'owner' && (
                          <>
                            <button className={iconButton} title="Change the name or colour" onClick={() => setRoleDraft({ id: r.id, name: r.name, color: r.color })} data-edit-role><Pencil className="size-3.5" /></button>
                            <button className={cn(iconButton, 'hover:text-accent')} title="Delete" onClick={() => setConfirm({ title: `Delete the role “${r.name}”?`, text: 'It comes off everyone who has it. Channels restricted to it stop letting those people in.', action: 'Delete role', run: async () => void (await run('Role deleted', () => api('DELETE', `/roles/${r.id}`))) })} data-delete-role><Trash2 className="size-3.5" /></button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {section === 'members' && (
              members === null ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-12 rounded-xl" />)}</div> : (
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border" data-settings-members>
                  {members.map((m) => {
                    const above = rankOf(role) > rankOf(m.role) && m.user.id !== myId
                    return (
                      <li key={m.user.id} className="flex items-center gap-2 bg-surface-2/40 px-3 py-2" data-settings-member={m.user.username}>
                        {person(
                          m.user,
                          <>
                            <span className="block text-[11px] text-muted">{m.online ? 'Online' : 'Offline'} · joined {formatAgo(m.joinedAt)}</span>
                            {c.roles.length > 0 && (can(role, 'manageRoles') && (above || m.user.id === myId) ? (
                              <span className="flex flex-wrap gap-1 pt-1" data-member-roles>
                                {c.roles.map((r) => {
                                  const has = m.roleIds.includes(r.id)
                                  return (
                                    <button key={r.id} disabled={busy} onClick={() => void run(null, () => api('PUT', `/${c.id}/members/${m.user.id}/roles`, { roleIds: has ? m.roleIds.filter((x) => x !== r.id) : [...m.roleIds, r.id] }))} title={has ? `Take “${r.name}” away` : `Give “${r.name}”`} aria-pressed={has} className={cn('rounded-full border px-2 text-[10px] font-bold leading-5 transition', has ? '' : 'border-border text-muted opacity-60 hover:opacity-100')} style={has ? { borderColor: r.color, color: r.color, background: `${r.color}22` } : undefined} data-role-chip={r.name} data-has={has}>
                                      {has ? '✓ ' : '+ '}{r.name}
                                    </button>
                                  )
                                })}
                              </span>
                            ) : m.roleIds.length > 0 ? (
                              <span className="flex flex-wrap gap-1 pt-1">
                                {c.roles.filter((r) => m.roleIds.includes(r.id)).map((r) => <span key={r.id} className="rounded-full border px-2 text-[10px] font-bold leading-5" style={{ borderColor: `${r.color}88`, color: r.color }}>{r.name}</span>)}
                              </span>
                            ) : null)}
                          </>
                        )}
                        {above && can(role, 'manageRoles') ? (
                          <select className="h-8 rounded-lg border border-border bg-surface-2 px-2 text-xs font-semibold" value={m.role} disabled={busy} aria-label={`Role of ${m.user.username}`} onChange={(e) => void run(`${m.user.username} is now ${ROLES.find((r) => r.id === e.target.value)?.label}`, () => api('PATCH', `/${c.id}/members/${m.user.id}`, { role: e.target.value }))} data-role-select>
                            {ROLES.filter((r) => r.id !== 'owner' && rankOf(r.id) < rankOf(role)).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                          </select>
                        ) : (
                          <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', m.role === 'owner' ? 'bg-amber-400/15 text-amber-300' : m.role === 'member' ? 'bg-white/8 text-muted' : 'bg-accent/15 text-accent')}>{ROLES.find((r) => r.id === m.role)?.label}</span>
                        )}
                        {above && can(role, 'kick') && <button className={iconButton} disabled={busy} title="Kick (they can come back)" onClick={() => void run(`${m.user.username} was kicked`, () => api('DELETE', `/${c.id}/members/${m.user.id}`))} data-kick><UserMinus className="size-4" /></button>}
                        {above && can(role, 'ban') && <button className={cn(iconButton, 'hover:text-accent')} disabled={busy} title="Ban (they can't come back)" onClick={() => setConfirm({ title: `Ban ${m.user.username}?`, text: 'They are removed and can’t come back by joining, asking or an invite, until you lift the ban.', action: 'Ban', run: async () => void (await run(`${m.user.username} was banned`, () => api('POST', `/${c.id}/bans`, { userId: m.user.id }))) })} data-ban><BanIcon className="size-4" /></button>}
                      </li>
                    )
                  })}
                </ul>
              )
            )}

            {section === 'invites' && (
              <>
                <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-surface-2/40 p-4">
                  <label className="text-xs font-semibold text-muted">
                    Runs out after
                    <select className={cn(field, 'mt-1 w-36')} value={inviteHours ?? ''} onChange={(e) => setInviteHours(e.target.value ? Number(e.target.value) : null)} data-invite-expiry>
                      <option value={1}>1 hour</option><option value={24}>1 day</option><option value={168}>7 days</option><option value={720}>30 days</option><option value="">Never</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-muted">
                    Can be used
                    <select className={cn(field, 'mt-1 w-36')} value={inviteUses ?? ''} onChange={(e) => setInviteUses(e.target.value ? Number(e.target.value) : null)} data-invite-uses>
                      <option value="">No limit</option><option value={1}>Once</option><option value={5}>5 times</option><option value={25}>25 times</option><option value={100}>100 times</option>
                    </select>
                  </label>
                  <Button variant="primary" className="h-10" disabled={busy} onClick={() => void run('Invite created', () => api('POST', `/${c.id}/invites`, { expiresHours: inviteHours, maxUses: inviteUses }))} data-create-invite>
                    <Link2 className="size-4" /> Create invite
                  </Button>
                </div>
                {invites === null ? <div className="skeleton h-12 rounded-xl" /> : invites.length === 0 ? empty('No invites yet. Create one and send its code to a friend: they enter it under “Join with a code”.') : (
                  <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border" data-invites>
                    {invites.map((i) => (
                      <li key={i.code} className="flex items-center gap-3 bg-surface-2/40 px-4 py-2.5" data-invite={i.code}>
                        <span className="rounded-lg bg-black/40 px-2.5 py-1 font-mono text-sm font-bold tracking-widest">{i.code}</span>
                        <span className="min-w-0 flex-1 text-xs text-muted">
                          {i.uses} used{i.maxUses ? ` of ${i.maxUses}` : ''} · {i.expiresAt ? `runs out ${new Date(i.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'never runs out'} · by {i.createdBy}
                        </span>
                        <button className={iconButton} title="Copy the code" onClick={() => void navigator.clipboard.writeText(i.code).then(() => toast('Invite code copied'), () => toast("Couldn't copy it.", 'error'))} data-copy-invite><Copy className="size-4" /></button>
                        <button className={cn(iconButton, 'hover:text-accent')} disabled={busy} title="Revoke: it stops working" onClick={() => void run('Invite revoked', () => api('DELETE', `/${c.id}/invites/${i.code}`))} data-revoke-invite><Trash2 className="size-4" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {section === 'invites' && (
              <div className="space-y-2" data-invite-friends>
                <h3 className="pt-2 text-xs font-bold uppercase tracking-widest text-muted">Invite a friend directly</h3>
                {(() => {
                  const inside = new Set((members ?? []).map((m) => m.user.id))
                  const list = (friends?.friends ?? []).filter((f) => !inside.has(f.id))
                  return list.length === 0 ? empty(friends?.friends.length ? 'All your friends are already here.' : 'Add friends in the Friends tab to invite them straight in.') : (
                    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
                      {list.map((f) => (
                        <li key={f.id} className="flex items-center gap-2 bg-surface-2/40 px-3 py-2" data-invite-friend={f.username}>
                          {person(f)}
                          {invited.includes(f.id) ? (
                            <Button variant="ghost" disabled={busy} onClick={() => void run('Invitation taken back', () => api('DELETE', `/${c.id}/direct-invites/${f.id}`))} title="Take the invitation back" data-uninvite>Invited ✓</Button>
                          ) : (
                            <Button disabled={busy} onClick={() => void run(`${f.username} was invited`, () => api('POST', `/${c.id}/direct-invites`, { userId: f.id }))} data-invite-direct><UserPlus className="size-4" /> Invite</Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )
                })()}
                <p className="text-xs text-muted">They get an invitation at the top of their Channels tab, and can join even if this Channel is Private or Hidden.</p>
              </div>
            )}

            {section === 'requests' && (
              requests === null ? <div className="skeleton h-12 rounded-xl" /> : requests.length === 0 ? empty(c.visibility === 'private' ? 'Nobody is waiting to be let in.' : 'Only Private Channels have join requests.') : (
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border" data-requests>
                  {requests.map((r) => (
                    <li key={r.user.id} className="flex items-center gap-2 bg-surface-2/40 px-3 py-2.5" data-request={r.user.username}>
                      {person(r.user, <span className="block truncate text-xs text-muted">{r.message || 'No message'} · {formatAgo(r.at)}</span>)}
                      <Button disabled={busy} onClick={() => void run(`${r.user.username} was let in`, () => api('POST', `/${c.id}/requests/${r.user.id}`, { approve: true }))} data-approve><UserPlus className="size-4" /> Approve</Button>
                      <Button variant="ghost" disabled={busy} onClick={() => void run('Request denied', () => api('POST', `/${c.id}/requests/${r.user.id}`, { approve: false }))} data-deny>Deny</Button>
                    </li>
                  ))}
                </ul>
              )
            )}

            {section === 'bans' && (
              bans === null ? <div className="skeleton h-12 rounded-xl" /> : bans.length === 0 ? empty('Nobody is banned.') : (
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border" data-bans>
                  {bans.map((b) => (
                    <li key={b.user.id} className="flex items-center gap-2 bg-surface-2/40 px-3 py-2.5" data-banned-user={b.user.username}>
                      {person(b.user, <span className="block truncate text-xs text-muted">{b.reason || 'No reason given'} · {formatAgo(b.at)}</span>)}
                      <Button disabled={busy} onClick={() => void run(`${b.user.username} can join again`, () => api('DELETE', `/${c.id}/bans/${b.user.id}`))} data-unban>Lift ban</Button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>

          {role !== 'owner' && (
            <footer className="shrink-0 border-t border-border px-6 py-3">
              <Button variant="ghost" className="text-accent" disabled={busy} onClick={() => setConfirm({ title: `Leave ${c.name}?`, text: c.visibility === 'open' ? 'You can join again any time.' : 'To come back you will need to be let in or invited again.', action: 'Leave', run: async () => { await api('POST', `/${c.id}/leave`); await refreshCommunities(); toast(`You left ${c.name}`); onGone() } })} data-leave-community>
                <LogOut className="size-4" /> Leave this Channel
              </Button>
            </footer>
          )}
        </div>
      </div>

      {(newChannel || newCategory !== null || renaming) && (() => {
        const value = newChannel ? newChannel.name : renaming ? renaming.name : newCategory!
        const max = newChannel || renaming?.kind === 'channel' ? LIMITS.channelName : LIMITS.categoryName
        const clean = tidyName(value, max)
        const close = (): void => (setNewChannel(null), setNewCategory(null), setRenaming(null))
        const save = async (): Promise<void> => {
          const ok = newChannel
            ? await run('Channel created', () => api('POST', `/${c.id}/channels`, { name: clean, categoryId: newChannel.categoryId }))
            : renaming
              ? await run('Renamed', () => api('PATCH', `/${renaming.kind === 'channel' ? 'channels' : 'categories'}/${renaming.id}`, { name: clean }))
              : await run('Category created', () => api('POST', `/${c.id}/categories`, { name: clean }))
          if (ok) close()
        }
        return (
          <Dialog title={newChannel ? 'New channel' : renaming ? `Rename ${renaming.kind}` : 'New category'} description={newChannel || renaming?.kind === 'channel' ? 'Spaces, capitals and emoji are all fine: “Late Night Gaming 🎮”.' : undefined} onClose={close} footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" disabled={!clean || busy} onClick={() => void save()} data-name-save><Check className="size-4" /> Save</Button></>}>
            <form className="space-y-3 p-6" onSubmit={(e) => { e.preventDefault(); if (clean && !busy) void save() }}>
              <input className={field} autoFocus value={value} maxLength={max * 2} placeholder={newChannel || renaming?.kind === 'channel' ? 'Late Night Gaming 🎮' : 'Off Topic'} aria-label="Name" onChange={(e) => (newChannel ? setNewChannel({ ...newChannel, name: e.target.value }) : renaming ? setRenaming({ ...renaming, name: e.target.value }) : setNewCategory(e.target.value))} data-name-input />
              <p className="text-xs text-muted">{[...clean].length}/{max}</p>
              {newChannel && (
                <select className={field} value={newChannel.categoryId ?? ''} onChange={(e) => setNewChannel({ ...newChannel, categoryId: e.target.value || null })} aria-label="Category">
                  <option value="">No category</option>
                  {ordered.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              )}
            </form>
          </Dialog>
        )
      })()}

      {roleDraft && (() => {
        const clean = tidyName(roleDraft.name, LIMITS.roleName)
        const save = async (): Promise<void> => {
          const ok = roleDraft.id
            ? await run('Role saved', () => api('PATCH', `/roles/${roleDraft.id}`, { name: clean, color: roleDraft.color }))
            : await run('Role created', () => api('POST', `/${c.id}/roles`, { name: clean, color: roleDraft.color }))
          if (ok) setRoleDraft(null)
        }
        return (
          <Dialog title={roleDraft.id ? 'Change role' : 'New role'} description="Its colour shows on the person's name in chat." onClose={() => setRoleDraft(null)} footer={<><Button variant="ghost" onClick={() => setRoleDraft(null)}>Cancel</Button><Button variant="primary" disabled={!clean || busy} onClick={() => void save()} data-role-save><Check className="size-4" /> Save</Button></>}>
            <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); if (clean && !busy) void save() }}>
              <input className={field} autoFocus value={roleDraft.name} maxLength={LIMITS.roleName * 2} placeholder="VIP" aria-label="Role name" onChange={(e) => setRoleDraft({ ...roleDraft, name: e.target.value })} data-role-name />
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
                {ROLE_COLORS.map((color) => (
                  <button key={color} type="button" role="radio" aria-checked={roleDraft.color === color} aria-label={color} onClick={() => setRoleDraft({ ...roleDraft, color })} className={cn('size-8 rounded-full transition hover:scale-110', roleDraft.color === color && 'ring-2 ring-white ring-offset-2 ring-offset-surface')} style={{ background: color }} data-role-color={color} />
                ))}
              </div>
              <p className="text-sm">Preview: <span className="font-bold" style={{ color: roleDraft.color }}>{clean || 'Role name'}</span></p>
            </form>
          </Dialog>
        )
      })()}

      {access && (() => {
        const options: { id: Restriction; label: string; hint: string }[] = [
          { id: 'none', label: 'Everyone', hint: 'Every member can read and write here.' },
          { id: 'post', label: 'Read-only', hint: 'Everyone can read. Only the roles below (and Owner, Admins, Moderators) can write. Good for announcements.' },
          { id: 'view', label: 'Private', hint: 'Only the roles below (and Owner, Admins, Moderators) can see this channel at all.' }
        ]
        const save = async (): Promise<void> => {
          if (await run('Saved', () => api('PATCH', `/channels/${access.channel.id}`, { restricted: access.restricted, roleIds: access.roleIds }))) setAccess(null)
        }
        return (
          <Dialog title={`Who “${access.channel.name}” is for`} onClose={() => setAccess(null)} footer={<><Button variant="ghost" onClick={() => setAccess(null)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => void save()} data-access-save><Check className="size-4" /> Save</Button></>}>
            <div className="space-y-4 p-6">
              <div className="grid gap-2" role="radiogroup" aria-label="Who it is for">
                {options.map((o) => (
                  <button key={o.id} role="radio" aria-checked={access.restricted === o.id} onClick={() => setAccess({ ...access, restricted: o.id })} className={cn('rounded-xl border px-4 py-2.5 text-left transition', access.restricted === o.id ? 'border-accent bg-accent/10 ring-2 ring-accent/30' : 'border-border hover:border-white/25')} data-access-option={o.id}>
                    <span className="block text-sm font-bold">{o.label}</span>
                    <span className="block text-xs text-muted">{o.hint}</span>
                  </button>
                ))}
              </div>
              {access.restricted !== 'none' && (
                <div>
                  <p className={label}>Roles let in</p>
                  {c.roles.length === 0 ? (
                    <p className="text-xs text-muted">There are no custom roles yet, so only the Owner, Admins and Moderators are let in. The owner can make roles under Roles.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {c.roles.map((r: CustomRole) => {
                        const on = access.roleIds.includes(r.id)
                        return (
                          <button key={r.id} aria-pressed={on} onClick={() => setAccess({ ...access, roleIds: on ? access.roleIds.filter((x) => x !== r.id) : [...access.roleIds, r.id] })} className={cn('rounded-full border px-3 py-1 text-xs font-bold transition', on ? '' : 'border-border text-muted hover:text-text')} style={on ? { borderColor: r.color, color: r.color, background: `${r.color}22` } : undefined} data-access-role={r.name}>
                            {on ? '✓ ' : ''}{r.name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Dialog>
        )
      })()}

      {confirm && (
        <Dialog title={confirm.title} description={confirm.text} onClose={() => setConfirm(null)} footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => { const c2 = confirm; setConfirm(null); void c2.run().catch((e: unknown) => toast(e instanceof Error ? e.message : 'That did not work.', 'error')) }} data-confirm-action>{confirm.action}</Button></>}>
          <div className="p-2" />
        </Dialog>
      )}
    </div>,
    document.body
  )
}
