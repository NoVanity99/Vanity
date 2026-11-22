import { useCallback, useEffect, useState } from 'react'
import { Ban, Check, ChevronLeft, ChevronRight, Clock, Coins, Crown, Eye, FlaskConical, Flag, Loader2, MessageSquareOff, PhoneOff, RefreshCw, RotateCcw, Search, ShieldCheck, Trash2, UserCog, X } from 'lucide-react'
import type { AccountStanding, PublicUser } from '@shared/types'
import { Avatar } from '@/components/Avatar'
import { BannedCard } from '@/components/auth/BannedCard'
import { Button, Dialog } from '@/components/Dialog'
import { ProfileCard } from '@/components/profile/ProfileCard'
import { UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { formatAgo } from '@/lib/format'
import { checkPulse } from '@/state/pulse'
import { useToast } from '@/state/toasts'
import { Section } from './controls'

// Settings → Admin. Shown only to accounts with the admin badge; the server checks the badge
// again on every one of these requests, so hiding the tab is not what protects anything.

type AdminUser = PublicUser & { email: string | null; createdAt: number | null; lastSeen: number | null; online: boolean; playing: string | null; coins: number; level: number; standing: AccountStanding; test: boolean }
type Overview = { users: number; online: number; new_week: number; in_voice: number; banned: number; comments: number; reports: number; sold: number; revenue: number; outstanding: number; unclaimedBadgeNames: string[] }
type LedgerRow = { id: number; kind: string; amount: number; note: string; at: number | null }
type Detail = {
  user: AdminUser & { bio: string }
  counts: { friends: number; comments: number; reports: number; messages: number; spent: number; bought: number }
  steam: { name: string; profileUrl: string } | null
  owned: string[]
  usernames: { from: string | null; to: string; byAdmin: boolean; at: number | null }[]
  ledger: LedgerRow[]
  log: { action: string; detail: string; admin: string | null; at: number | null }[]
  plus?: { active: boolean; subscribed: boolean; status: string; renewsAt: number | null; giftedUntil: number | null }
}
type View = { user: PublicUser & { bio: string }; standing: AccountStanding; coins: number; owned: string[]; ledger: LedgerRow[]; counts: { friends: number; requests: number; unread: number }; usernameChangeAt: number | null; banned: string | null; speaking: string | null; test: boolean }
type Report = { commentId: number; gameKey: string; text: string; at: number | null; user: PublicUser; reports: number; reasons: string[] }
type LogRow = { id: number; action: string; detail: string; admin: string | null; target: string | null; targetId: string | null; at: number | null }

const api = window.vanity?.account
const get = <T,>(path: string): Promise<T> => call<T>('GET', path)
async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const r = await window.vanity.account.request<T>(method, path, body).catch(() => null)
  if (!r) throw new Error("Couldn't reach Vanity. Check your connection.")
  if (r.error !== undefined) throw new Error(r.error)
  return r.data
}
void api
const n = (v: number): string => v.toLocaleString()
const when = (at: number | null): string => (at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never')
const field = 'h-10 rounded-xl border border-border bg-surface-2 px-3 text-sm outline-none transition focus:border-accent'

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p className={cn('font-display text-2xl font-black tabular-nums', tone)}>{value}</p>
    </div>
  )
}

function StatusChips({ u }: { u: AdminUser }): React.JSX.Element {
  const chip = 'rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide'
  return (
    <span className="flex flex-wrap items-center gap-1">
      {u.test && <span className={cn(chip, 'bg-sky-400/15 text-sky-300')}>Test</span>}
      {u.standing.banned && <span className={cn(chip, 'bg-accent/20 text-accent')}>Banned</span>}
      {u.standing.timeoutUntil && <span className={cn(chip, 'bg-amber-400/15 text-amber-300')}>Timed out</span>}
      {u.online && !u.standing.banned && <span className={cn(chip, 'bg-emerald-400/15 text-emerald-300')}>{u.playing ? 'Playing' : 'Online'}</span>}
    </span>
  )
}

/**
 * "See what they see": the account's own view of Vanity right now, built from what the server
 * would tell their app. A banned account gets the ban screen in place of the launcher.
 */
function ViewAs({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const [v, setV] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => void get<View>(`/admin/users/${id}/view`).then(setV, (e: Error) => setError(e.message)), [id])
  useEffect(load, [load])
  return (
    <Dialog size="xl" title={v ? `What ${v.user.username} sees` : 'What they see'} description="Their own view of Vanity right now, exactly as their app shows it." onClose={onClose} footer={<Button onClick={load}><RefreshCw className="size-4" /> Refresh</Button>}>
      <div className="p-6" data-view-as={v?.user.username}>
        {error ? (
          <p role="alert" className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">{error}</p>
        ) : !v ? (
          <div className="flex h-40 items-center justify-center text-muted"><Loader2 className="size-5 animate-spin" /></div>
        ) : (
          // A little copy of their window.
          <div className="overflow-hidden rounded-2xl border border-white/15 bg-bg shadow-2xl">
            <div className="flex h-8 items-center gap-2 border-b border-border bg-surface px-3 text-[11px] text-muted">
              <span className="font-display font-black text-text">Van<span className="text-accent">ity</span></span>
              <span className="truncate">· {v.user.username}'s screen</span>
              {!v.banned && (
                <span className="ml-auto flex items-center gap-1 rounded-full border border-amber-300/30 px-2 py-px font-bold tabular-nums text-amber-200" data-view-coins={v.coins}>
                  <Coins className="size-3" /> {n(v.coins)}
                </span>
              )}
            </div>
            {v.banned ? (
              <div className="relative flex min-h-80 items-center justify-center bg-black/55 p-6 backdrop-blur" data-view-banned>
                <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-surface p-7 shadow-2xl">
                  <p className="mb-5 text-center font-display text-2xl font-black">Van<span className="text-accent">ity</span></p>
                  <BannedCard name={v.user.username} reason={v.standing.reason} />
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-4">
                <ProfileCard name={v.user.username} avatar={v.user.avatar} bio={v.user.bio} style={v.user.style} verified={v.user.verified} admin={v.user.admin} status="online">
                  <p className="mt-0.5 text-xs text-muted">{n(v.counts.friends)} friends · {n(v.counts.requests)} friend requests waiting · {n(v.counts.unread)} unread messages</p>
                </ProfileCard>
                <div className={cn('rounded-xl border px-4 py-3 text-sm', v.speaking ? 'border-amber-400/40 bg-amber-400/10' : 'border-border bg-surface')} data-view-speaking={v.speaking ? 'blocked' : 'ok'}>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">When they send a message, comment or start a call</p>
                  {v.speaking ? <p className="mt-1 font-semibold text-amber-200">They see: “{v.speaking}”</p> : <p className="mt-1 text-emerald-400">It works as normal.</p>}
                </div>
                <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
                  <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Changing their username</p>
                    <p className="mt-1">{v.usernameChangeAt ? `Has to wait until ${new Date(v.usernameChangeAt).toLocaleDateString(undefined, { dateStyle: 'long' })}.` : 'They can change it now.'}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Premium looks they own</p>
                    <p className="mt-1">{v.owned.length ? v.owned.map((o) => o.split(':')[1]).join(', ') : 'None yet.'}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Their purchase history (latest)</p>
                  {v.ledger.length === 0 ? <p className="mt-1 text-muted">Empty.</p> : (
                    <ul className="mt-1.5 space-y-1">
                      {v.ledger.map((l) => (
                        <li key={l.id} className="flex items-center gap-2 text-xs">
                          <span className={cn('w-16 font-bold tabular-nums', l.amount >= 0 ? 'text-emerald-400' : 'text-accent')}>{l.amount > 0 ? '+' : ''}{n(l.amount)}</span>
                          <span className="min-w-0 flex-1 truncate">{l.note || l.kind}</span>
                          <span className="text-muted">{formatAgo(l.at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}

/** One account: everything about it, and everything an admin can do to it. */
function UserDialog({ id, myName, onClose, onChanged }: { id: string; myName: string | null; onClose: () => void; onChanged: () => void }): React.JSX.Element {
  const toast = useToast()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [coins, setCoins] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [rename, setRename] = useState('')
  const [viewing, setViewing] = useState(false)
  const [confirm, setConfirm] = useState<'delete' | 'ban' | null>(null)

  const load = useCallback(() => get<Detail>(`/admin/users/${id}`).then(setD, (e: Error) => setError(e.message)), [id])
  useEffect(() => void load(), [load])

  /** Does one thing, says so, and shows the account as it is afterwards. */
  const run = async (what: string, fn: () => Promise<unknown>, closeAfter = false): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      toast(what)
      onChanged()
      // Coins given to yourself show in your own top bar at once.
      void checkPulse()
      if (closeAfter) return onClose()
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work.', 'error')
    } finally {
      setBusy(false)
    }
  }
  const post = (path: string, body?: unknown) => call('POST', `/admin/users/${id}/${path}`, body ?? {})
  const u = d?.user
  const amount = Math.trunc(Number(coins))
  const label = 'mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted'

  return (
    <Dialog size="2xl" title={u ? u.username : 'Account'} description={u ? `${u.email ?? (u.test ? 'A test account: nobody can sign in to it' : 'Email not available')} · joined ${when(u.createdAt)}` : undefined} onClose={onClose}>
      {error ? (
        <p role="alert" className="m-6 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">{error}</p>
      ) : !d || !u ? (
        <div className="flex h-60 items-center justify-center text-muted"><Loader2 className="size-5 animate-spin" /></div>
      ) : (
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_20rem]" data-admin-user={u.username}>
          <div className="min-w-0 space-y-5">
            <ProfileCard name={u.username} avatar={u.avatar} bio={d.user.bio} style={u.style} verified={u.verified} admin={u.admin} status={u.online ? (u.playing ? 'playing' : 'online') : 'offline'}>
              <div className="mt-1.5"><StatusChips u={u} /></div>
              <p className="mt-1 break-all text-[11px] text-muted">ID {u.id}</p>
            </ProfileCard>
            {u.standing.banned && <p className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm" data-admin-banned>Banned{u.standing.reason ? `: ${u.standing.reason}` : ''}</p>}
            {u.standing.timeoutUntil && <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-100" data-admin-timeout>Timed out until {when(u.standing.timeoutUntil)}: no messages, comments or voice.</p>}

            <div className="grid grid-cols-4 gap-2 max-md:grid-cols-2">
              <Stat label="Coins" value={n(u.coins)} tone="text-amber-300" />
              <Stat label="Level" value={n(u.level)} />
              <Stat label="Friends" value={n(d.counts.friends)} />
              <Stat label="Comments" value={n(d.counts.comments)} />
            </div>
            <p className="text-xs text-muted">
              Last seen {u.online ? 'now' : formatAgo(u.lastSeen)}{u.playing ? ` · playing ${u.playing}` : ''} · {n(d.counts.messages)} messages sent · {n(d.counts.reports)} reports against their comments · bought {n(d.counts.bought)} coins for ${(d.counts.spent / 100).toFixed(2)}
              {d.steam ? ` · Steam: ${d.steam.name}` : ''}
            </p>

            <div>
              <p className={label}>Usernames</p>
              <ul className="space-y-1 text-sm">
                {d.usernames.map((h, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="font-semibold">{h.to}</span>
                    {h.from && <span className="text-muted">from {h.from}</span>}
                    {h.byAdmin && h.from && <span className="rounded bg-white/8 px-1 text-[10px] text-muted">by an admin</span>}
                    <span className="ml-auto text-xs text-muted">{when(h.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className={label}>Coin history (latest 30)</p>
              {d.ledger.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
                <ul className="max-h-44 space-y-1 overflow-y-auto pr-1 text-sm [scrollbar-width:thin]" data-admin-ledger>
                  {d.ledger.map((l) => (
                    <li key={l.id} className="flex items-center gap-2">
                      <span className={cn('w-20 font-bold tabular-nums', l.amount >= 0 ? 'text-emerald-400' : 'text-accent')}>{l.amount > 0 ? '+' : ''}{n(l.amount)}</span>
                      <span className="w-20 text-xs uppercase text-muted">{l.kind}</span>
                      <span className="min-w-0 flex-1 truncate">{l.note}</span>
                      <span className="text-xs text-muted">{formatAgo(l.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {d.log.length > 0 && (
              <div>
                <p className={label}>What admins did to this account</p>
                <ul className="max-h-36 space-y-1 overflow-y-auto pr-1 text-xs [scrollbar-width:thin]">
                  {d.log.map((l, i) => (
                    <li key={i} className="flex gap-2"><span className="font-semibold">{l.admin ?? 'someone'}</span><span>{l.action}{l.detail ? `: ${l.detail}` : ''}</span><span className="ml-auto shrink-0 text-muted">{formatAgo(l.at)}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="space-y-5">
            <Button variant="primary" className="w-full" onClick={() => setViewing(true)} data-admin-view>
              <Eye className="size-4" /> See what they see
            </Button>

            <div data-admin-coins>
              <p className={label}>Vanity Coins</p>
              <div className="flex gap-2">
                <input className={cn(field, 'w-28')} inputMode="numeric" placeholder="Amount" aria-label="Coins to add (negative takes away)" value={coins} onChange={(e) => setCoins(e.target.value.replace(/[^\d-]/g, '').slice(0, 8))} data-admin-coin-amount />
                <input className={cn(field, 'min-w-0 flex-1')} placeholder="Note (optional)" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[100, 500, 1000, 5000].map((v) => (
                  <button key={v} onClick={() => setCoins(String(v))} className="rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted transition hover:border-amber-300/60 hover:text-amber-200">+{n(v)}</button>
                ))}
              </div>
              <Button className="mt-2 w-full" disabled={busy || !Number.isFinite(amount) || amount === 0} onClick={() => void run(`${amount > 0 ? 'Added' : 'Took'} ${n(Math.abs(amount))} coins`, () => post('coins', { amount, note }).then(() => (setCoins(''), setNote(''))))} data-admin-give-coins>
                <Coins className="size-4 text-amber-300" /> {amount < 0 ? `Take ${n(Math.abs(amount))} coins` : `Add ${amount > 0 ? n(amount) : ''} coins`}
              </Button>
              <p className="mt-1 text-xs text-muted">They can use them straight away; their balance updates by itself in a few seconds. A negative amount takes coins away.</p>
            </div>

            <div data-admin-plus>
              <p className={label}>Vanity Plus</p>
              <p className="mb-2 text-xs text-muted" data-admin-plus-state>
                {d.plus?.subscribed ? `Paying member (${d.plus.status})${d.plus.renewsAt ? `, renews ${when(d.plus.renewsAt)}` : ''}.` : d.plus?.giftedUntil ? `Gifted until ${when(d.plus.giftedUntil)}.` : 'Not a member.'}
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {([['7 days', 7], ['30 days', 30], ['1 year', 365]] as const).map(([text, days]) => (
                  <Button key={days} className="px-1 text-xs" disabled={busy} onClick={() => void run(`Gave Vanity Plus for ${text}`, () => post('plus', { days }))} data-admin-plus-days={days}>{text}</Button>
                ))}
                <Button className="px-1 text-xs" disabled={busy || !d.plus?.giftedUntil} onClick={() => void run('Plus gift ended', () => post('plus', { days: 0 }))}>End gift</Button>
              </div>
            </div>

            <div data-admin-timeouts>
              <p className={label}>Time out (no messages, comments or voice)</p>
              <div className="grid grid-cols-4 gap-1.5">
                {([['15 min', 15], ['1 hour', 60], ['1 day', 1440], ['7 days', 10080]] as const).map(([text, minutes]) => (
                  <Button key={minutes} className="px-1 text-xs" disabled={busy} onClick={() => void run(`Timed out for ${text}`, () => post('timeout', { minutes }))} data-admin-timeout-for={minutes}>{text}</Button>
                ))}
              </div>
              {u.standing.timeoutUntil && <Button className="mt-2 w-full" disabled={busy} onClick={() => void run('Time-out ended', () => post('timeout', { minutes: 0 }))} data-admin-end-timeout><Clock className="size-4" /> End the time-out now</Button>}
            </div>

            <div>
              <p className={label}>Ban</p>
              {u.standing.banned ? (
                <Button className="w-full" disabled={busy} onClick={() => void run('Unbanned', () => post('unban'))} data-admin-unban><Check className="size-4" /> Unban</Button>
              ) : (
                <>
                  <input className={cn(field, 'w-full')} placeholder="Reason (they are shown this)" aria-label="Ban reason" value={reason} onChange={(e) => setReason(e.target.value.slice(0, 200))} data-admin-ban-reason />
                  <Button className="mt-2 w-full border-accent/40 text-accent hover:bg-accent/15" disabled={busy} onClick={() => setConfirm('ban')} data-admin-ban><Ban className="size-4" /> Ban this account</Button>
                </>
              )}
            </div>

            <div>
              <p className={label}>Badges</p>
              <div className="grid grid-cols-2 gap-1.5">
                <Button className={cn('text-xs', u.verified && 'border-sky-400/50 text-sky-300')} disabled={busy} onClick={() => void run(u.verified ? 'Verified badge removed' : 'Verified', () => post('roles', { verified: !u.verified }))} data-admin-verified={u.verified}><ShieldCheck className="size-4" /> {u.verified ? 'Verified ✓' : 'Verify'}</Button>
                <Button className={cn('text-xs', u.admin && 'border-amber-300/50 text-amber-300')} disabled={busy} onClick={() => void run(u.admin ? 'Admin badge removed' : 'Made an admin', () => post('roles', { admin: !u.admin }))} data-admin-admin={u.admin}><Crown className="size-4" /> {u.admin ? 'Admin ✓' : 'Make admin'}</Button>
              </div>
            </div>

            <div>
              <p className={label}>Username</p>
              <div className="flex gap-2">
                <input className={cn(field, 'min-w-0 flex-1')} placeholder="New username" aria-label="New username" value={rename} onChange={(e) => setRename(e.target.value.slice(0, 20))} spellCheck={false} />
                <Button disabled={busy || !/^[A-Za-z0-9_]{3,20}$/.test(rename)} onClick={() => void run(`Renamed to ${rename}`, () => post('username', { username: rename }).then(() => setRename('')))}><UserCog className="size-4" /> Rename</Button>
              </div>
              <Button variant="ghost" className="mt-1 w-full justify-start px-1 text-xs" disabled={busy} onClick={() => void run('They can change their username again now', () => post('clear-cooldown'))}><RotateCcw className="size-3.5" /> Let them change it again now (skip the 30 days)</Button>
            </div>

            <div>
              <p className={label}>Clean up</p>
              <div className="grid gap-1.5">
                <Button className="justify-start text-xs" disabled={busy} onClick={() => void run('Profile reset', () => post('reset-profile'))} data-admin-reset><RotateCcw className="size-4" /> Reset picture, bio and look</Button>
                <Button className="justify-start text-xs" disabled={busy} onClick={() => void run('Their comments were removed', () => post('delete-comments'))}><MessageSquareOff className="size-4" /> Delete all their comments</Button>
                <Button className="justify-start text-xs" disabled={busy} onClick={() => void run('Taken out of voice', () => post('kick-voice'))}><PhoneOff className="size-4" /> Kick from voice</Button>
                <Button className="justify-start text-xs text-accent hover:bg-accent/15" disabled={busy} onClick={() => setConfirm('delete')} data-admin-delete><Trash2 className="size-4" /> Delete this account</Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {viewing && <ViewAs id={id} onClose={() => setViewing(false)} />}
      {confirm && u && (
        <Dialog
          title={confirm === 'ban' ? `Ban ${u.username}?` : `Delete ${u.username}'s account?`}
          description={confirm === 'ban' ? 'They are shut out of Vanity straight away and shown the reason. You can unban them later.' : "This removes their profile, friends, messages, stats and comments for good. Their coin record is kept. It can't be undone."}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  const what = confirm
                  setConfirm(null)
                  if (what === 'ban') void run(`${u.username} is banned`, () => post('ban', { reason }))
                  else void run(`${u.username}'s account was deleted`, () => call('DELETE', `/admin/users/${id}`), true)
                }}
                data-admin-confirm
              >
                {confirm === 'ban' ? 'Ban' : 'Delete for good'}
              </Button>
            </>
          }
        >
          <div className="p-6 text-sm text-muted">{confirm === 'ban' ? (reason ? `Reason they'll see: “${reason}”` : 'No reason given: they are told it broke the rules.') : `Signed in as ${myName ?? 'an admin'}: this is written to the admin log.`}</div>
        </Dialog>
      )}
    </Dialog>
  )
}

const FILTERS = [['', 'Everyone'], ['online', 'Online'], ['staff', 'Staff (admins)'], ['verified', 'Verified'], ['banned', 'Banned'], ['timedout', 'Timed out']] as const

interface AdminChannel {
  id: string
  name: string
  description: string
  visibility: 'open' | 'private' | 'hidden'
  createdAt: number | null
  owner: string
  members: number
  messages: number
  files: number
}

export function AdminPanel(): React.JSX.Element {
  const toast = useToast()
  const [view, setView] = useState<'users' | 'reports' | 'channels' | 'log'>('users')
  const [channels, setChannels] = useState<AdminChannel[] | null>(null)
  const [channelQ, setChannelQ] = useState('')
  const [removing, setRemoving] = useState<AdminChannel | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const [users, setUsers] = useState<{ users: AdminUser[]; total: number; pageSize: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [reports, setReports] = useState<Report[] | null>(null)
  const [log, setLog] = useState<LogRow[] | null>(null)
  const [myName, setMyName] = useState<string | null>(null)
  const [making, setMaking] = useState(false)
  const [tick, setTick] = useState(0)
  const refresh = (): void => setTick((t) => t + 1)

  useEffect(() => void window.vanity.account.state().then((s) => setMyName(s.username), () => {}), [])
  useEffect(() => void get<Overview>('/admin/overview').then(setOverview, () => {}), [tick])

  // The list follows the search a moment after typing stops.
  useEffect(() => {
    if (view !== 'users') return
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      get<{ users: AdminUser[]; total: number; pageSize: number }>(`/admin/users?page=${page}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}${filter ? `&filter=${filter}` : ''}`)
        .then(
          (r) => !cancelled && (setUsers(r), setError(null)),
          (e: Error) => !cancelled && setError(e.message)
        )
        .finally(() => !cancelled && setLoading(false))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q, filter, page, view, tick])
  useEffect(() => {
    if (view === 'reports') void get<{ reports: Report[] }>('/admin/reports').then((r) => setReports(r.reports), (e: Error) => setError(e.message))
    if (view === 'log') void get<{ log: LogRow[] }>('/admin/log').then((r) => setLog(r.log), (e: Error) => setError(e.message))
  }, [view, tick])
  useEffect(() => {
    if (view !== 'channels') return
    const wait = setTimeout(() => void get<{ communities: AdminChannel[] }>(`/admin/communities${channelQ.trim() ? `?q=${encodeURIComponent(channelQ.trim().replace(/[!'()*]/g, ' '))}` : ''}`).then((r) => setChannels(r.communities), (e: Error) => setError(e.message)), 250)
    return () => clearTimeout(wait)
  }, [view, channelQ, tick])
  const removeChannel = async (ch: AdminChannel): Promise<void> => {
    setRemoving(null)
    try {
      await call('DELETE', `/admin/communities/${ch.id}`)
      toast(`${ch.name} was deleted`)
      refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work.', 'error')
    }
  }

  const settle = async (r: Report, remove: boolean): Promise<void> => {
    try {
      await call('POST', `/admin/reports/${r.commentId}`, { remove })
      toast(remove ? 'Comment removed' : 'Comment kept')
      refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work.', 'error')
    }
  }
  const makeTestUser = async (): Promise<void> => {
    setMaking(true)
    try {
      const t = await call<{ id: string; username: string }>('POST', '/admin/test-users')
      toast(`Test user ${t.username} is ready`)
      refresh()
      setOpen(t.id)
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't make a test user.", 'error')
    } finally {
      setMaking(false)
    }
  }
  const pages = users ? Math.max(1, Math.ceil(users.total / users.pageSize)) : 1
  const tabClass = (on: boolean): string => cn('rounded-lg px-3 py-1.5 text-sm font-semibold transition', on ? 'bg-accent text-white' : 'text-muted hover:bg-white/5 hover:text-text')

  return (
    <div className="space-y-6" data-admin-panel>
      <Section title="Vanity at a glance" description="Only admins can see this tab. Everything you do here is written to the admin log.">
        {!overview ? (
          <div className="flex h-20 items-center justify-center text-muted"><Loader2 className="size-5 animate-spin" /></div>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-2 max-lg:grid-cols-3 max-md:grid-cols-2" data-admin-overview>
              <Stat label="Accounts" value={n(overview.users)} />
              <Stat label="Online now" value={n(overview.online)} tone="text-emerald-400" />
              <Stat label="New this week" value={n(overview.new_week)} />
              <Stat label="In voice" value={n(overview.in_voice)} />
              <Stat label="Banned" value={n(overview.banned)} tone={overview.banned ? 'text-accent' : undefined} />
              <Stat label="Comments" value={n(overview.comments)} />
              <Stat label="Open reports" value={n(overview.reports)} tone={overview.reports ? 'text-amber-300' : undefined} />
              <Stat label="Coins sold" value={n(overview.sold)} tone="text-amber-300" />
              <Stat label="Taken in" value={`$${(overview.revenue / 100).toFixed(2)}`} />
              <Stat label="Coins held by players" value={n(overview.outstanding)} />
            </div>
            {overview.unclaimedBadgeNames.length > 0 && (
              <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-xs text-amber-100" data-unclaimed>
                Official names nobody has signed up with yet: <span className="font-semibold">{overview.unclaimedBadgeNames.join(', ')}</span>. Whoever creates an account with one of these names gets its badge, so make sure the right person does.
              </p>
            )}
          </>
        )}
      </Section>

      <Section title="Manage">
        <div className="-mt-2 mb-4 flex flex-wrap items-center gap-1">
          <button className={tabClass(view === 'users')} onClick={() => setView('users')} data-admin-view-users>Accounts</button>
          <button className={tabClass(view === 'reports')} onClick={() => setView('reports')} data-admin-view-reports>
            Reported comments{overview?.reports ? <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-[10px] font-black text-black">{overview.reports}</span> : null}
          </button>
          <button className={tabClass(view === 'channels')} onClick={() => setView('channels')} data-admin-view-channels>Channels</button>
          <button className={tabClass(view === 'log')} onClick={() => setView('log')} data-admin-view-log>Admin log</button>
          <button onClick={refresh} title="Refresh" className="ml-auto rounded-lg p-2 text-muted transition hover:bg-white/5 hover:text-text"><RefreshCw className={cn('size-4', loading && 'animate-spin')} /></button>
        </div>
        {error && <p role="alert" className="mb-3 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">{error}</p>}

        {view === 'users' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-56 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input className={cn(field, 'w-full pl-9')} placeholder="Search by username, old username, email or ID" aria-label="Search accounts" value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} spellCheck={false} data-admin-search />
                {q && <button onClick={() => (setQ(''), setPage(0))} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-text"><X className="size-4" /></button>}
              </div>
              <Button onClick={() => void makeTestUser()} disabled={making} title="A throwaway account to try bans, time-outs and coins on" data-admin-make-test>
                {making ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />} Create test user
              </Button>
              {users?.users.some((u) => u.test) && (
                <Button variant="ghost" className="text-xs" onClick={() => void call<{ removed: number }>('POST', '/admin/test-users/clear').then((r) => (toast(`${r.removed} test user${r.removed === 1 ? '' : 's'} removed`), refresh()), (e: Error) => toast(e.message, 'error'))} data-admin-clear-test>
                  <Trash2 className="size-3.5" /> Remove test users
                </Button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {FILTERS.map(([id, text]) => (
                <button key={id} onClick={() => (setFilter(id), setPage(0))} className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition', filter === id ? 'border-accent bg-accent/15 text-text' : 'border-border text-muted hover:text-text')} data-admin-filter={id || 'all'}>{text}</button>
              ))}
              {users && <span className="ml-auto self-center text-xs text-muted" data-admin-total={users.total}>{n(users.total)} account{users.total === 1 ? '' : 's'}</span>}
            </div>
            <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border" data-admin-users>
              {!users ? (
                <li className="flex h-24 items-center justify-center text-muted"><Loader2 className="size-5 animate-spin" /></li>
              ) : users.users.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-muted">Nobody matches.</li>
              ) : (
                users.users.map((u) => (
                  <li key={u.id}>
                    <button onClick={() => setOpen(u.id)} className="flex w-full items-center gap-3 bg-surface-2/60 px-4 py-2.5 text-left transition hover:bg-white/5" data-admin-row={u.username}>
                      <Avatar name={u.username} src={u.avatar} frame={u.style?.frame} size="sm" status={u.online ? (u.playing ? 'playing' : 'online') : 'offline'} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-semibold"><UserName name={u.username} style={u.style} verified={u.verified} admin={u.admin} /><StatusChips u={u} /></span>
                        <span className="block truncate text-xs text-muted">{u.email ?? (u.test ? 'test account' : 'no email shown')} · joined {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '?'} · {u.online ? (u.playing ? `playing ${u.playing}` : 'online') : `seen ${formatAgo(u.lastSeen)}`}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs font-bold tabular-nums text-amber-200"><Coins className="size-3.5" /> {n(u.coins)}</span>
                      <span className="w-12 shrink-0 text-right text-xs text-muted">Lv {u.level}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            {pages > 1 && (
              <div className="mt-3 flex items-center justify-center gap-3 text-sm">
                <Button disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="size-4" /> Newer</Button>
                <span className="text-muted">Page {page + 1} of {pages}</span>
                <Button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Older <ChevronRight className="size-4" /></Button>
              </div>
            )}
          </>
        )}

        {view === 'reports' && (
          !reports ? <div className="flex h-24 items-center justify-center text-muted"><Loader2 className="size-5 animate-spin" /></div>
          : reports.length === 0 ? <p className="py-8 text-center text-sm text-muted" data-admin-reports="0">No reported comments. All clear.</p>
          : (
            <ul className="space-y-3" data-admin-reports={reports.length}>
              {reports.map((r) => (
                <li key={r.commentId} className="rounded-xl border border-border bg-surface-2/60 p-4" data-admin-report={r.commentId}>
                  <div className="flex items-center gap-2 text-sm">
                    <Flag className="size-4 text-amber-300" />
                    <button className="font-semibold hover:underline" onClick={() => setOpen(r.user.id)}>{r.user.username}</button>
                    <span className="text-xs text-muted">on {r.gameKey.replace(/^g:/, '').replace(/-/g, ' ')} · {formatAgo(r.at)}</span>
                    <span className="ml-auto rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">{r.reports} report{r.reports === 1 ? '' : 's'}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-black/25 px-3 py-2 text-sm">{r.text}</p>
                  {r.reasons.length > 0 && <p className="mt-1.5 text-xs text-muted">Why: {r.reasons.join(' · ')}</p>}
                  <div className="mt-3 flex justify-end gap-2">
                    <Button onClick={() => void settle(r, false)} data-report-keep><Check className="size-4" /> Keep it</Button>
                    <Button className="border-accent/40 text-accent hover:bg-accent/15" onClick={() => void settle(r, true)} data-report-remove><Trash2 className="size-4" /> Remove comment</Button>
                  </div>
                </li>
              ))}
            </ul>
          )
        )}

        {view === 'channels' && (
          <>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input className={cn(field, 'w-full pl-9')} placeholder="Search Channels by name, description or owner" aria-label="Search Channels" value={channelQ} onChange={(e) => setChannelQ(e.target.value.slice(0, 60))} spellCheck={false} data-admin-channel-search />
            </div>
            <p className="mb-3 text-xs text-muted">Every Channel on Vanity, Hidden ones included. This is the only place Hidden Channels are listed.</p>
            {!channels ? <div className="flex h-24 items-center justify-center text-muted"><Loader2 className="size-5 animate-spin" /></div>
            : channels.length === 0 ? <p className="py-8 text-center text-sm text-muted">No Channels{channelQ.trim() ? ' match that' : ' yet'}.</p>
            : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border text-sm" data-admin-channels>
                {channels.map((ch) => (
                  <li key={ch.id} className="flex items-center gap-3 px-3 py-2.5" data-admin-channel={ch.name}>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-semibold">
                        <span className="truncate">{ch.name}</span>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', ch.visibility === 'hidden' ? 'bg-amber-400/20 text-amber-300' : ch.visibility === 'private' ? 'bg-sky-400/20 text-sky-300' : 'bg-emerald-400/15 text-emerald-300')}>{ch.visibility}</span>
                      </span>
                      <span className="block truncate text-xs text-muted">
                        Owner: {ch.owner} · {ch.members.toLocaleString()} member{ch.members === 1 ? '' : 's'} · {ch.messages.toLocaleString()} message{ch.messages === 1 ? '' : 's'} · {ch.files.toLocaleString()} file{ch.files === 1 ? '' : 's'}{ch.createdAt ? ` · made ${new Date(ch.createdAt).toLocaleDateString()}` : ''}
                      </span>
                      {ch.description && <span className="block truncate text-xs text-muted/80">{ch.description}</span>}
                    </span>
                    <button onClick={() => setRemoving(ch)} className="rounded-lg border border-accent/40 px-2.5 py-1.5 text-xs font-bold text-accent transition hover:bg-accent/15" data-admin-delete-channel>Delete</button>
                  </li>
                ))}
              </ul>
            )}
            {removing && (
              <Dialog title={`Delete ${removing.name}?`} description={`Its channels, messages, files and ${removing.members} member${removing.members === 1 ? '' : 's'} are removed for everyone, for good. This is written to the admin log.`} onClose={() => setRemoving(null)} footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="primary" onClick={() => void removeChannel(removing)} data-admin-delete-channel-confirm>Delete for good</Button></>}>
                <div className="p-2" />
              </Dialog>
            )}
          </>
        )}

        {view === 'log' && (
          !log ? <div className="flex h-24 items-center justify-center text-muted"><Loader2 className="size-5 animate-spin" /></div>
          : log.length === 0 ? <p className="py-8 text-center text-sm text-muted">Nothing has been done yet.</p>
          : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border text-sm" data-admin-log>
              {log.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-2 bg-surface-2/60 px-4 py-2">
                  <span className="font-semibold">{l.admin ?? 'someone'}</span>
                  <span>{l.action}</span>
                  {l.target && <button className="font-semibold text-accent hover:underline" onClick={() => l.targetId && setOpen(l.targetId)}>{l.target}</button>}
                  {l.detail && <span className="min-w-0 truncate text-muted">{l.detail}</span>}
                  <span className="ml-auto text-xs text-muted">{when(l.at)}</span>
                </li>
              ))}
            </ul>
          )
        )}
      </Section>

      {open && <UserDialog id={open} myName={myName} onClose={() => setOpen(null)} onChanged={refresh} />}
    </div>
  )
}
