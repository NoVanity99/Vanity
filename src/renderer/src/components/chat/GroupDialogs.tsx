import { useState } from 'react'
import { Check, Crown, Loader2, LogOut, UserMinus, UserPlus } from 'lucide-react'
import { MAX_GROUP_NAME, MAX_GROUP_SIZE, type GroupChat } from '@shared/groups'
import { Avatar } from '@/components/Avatar'
import { Button, Dialog } from '@/components/Dialog'
import { UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { useAccount } from '@/state/account'
import { closeChat, groupChatId, openGroupChat } from '@/state/chats'
import { useFriends } from '@/state/friends'
import { refreshGroups } from '@/state/groups'
import { useToast } from '@/state/toasts'

/** Pick friends (and a name, if you like) for a new group chat. */
export function NewGroupDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const friends = useFriends()?.friends ?? []
  const toast = useToast()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const toggle = (id: string): void =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else if (n.size + 1 < MAX_GROUP_SIZE) n.add(id)
      return n
    })
  const create = async (): Promise<void> => {
    setBusy(true)
    const r = await window.vanity.groups.create(name.trim(), [...picked]).catch(() => null)
    setBusy(false)
    if (!r || r.error !== undefined) return toast(r?.error ?? "Couldn't make the group.", 'error')
    await refreshGroups()
    openGroupChat(r.data)
    toast(`${r.data.name} is ready`)
    onClose()
  }
  return (
    <Dialog
      title="New group chat"
      description={`Up to ${MAX_GROUP_SIZE} people. Everyone in it can add their own friends later.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void create()} disabled={!picked.size || busy} data-create-group>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Make group ({picked.size + 1})
          </Button>
        </>
      }
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, MAX_GROUP_NAME))}
        placeholder="Group name (optional)"
        aria-label="Group name"
        className="h-10 w-full rounded-xl border border-border bg-surface-2 px-4 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
        data-group-name
      />
      <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-widest text-muted">Friends</p>
      {friends.length === 0 ? (
        <p className="text-sm text-muted">Add some friends first.</p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
          {friends.map((f) => (
            <li key={f.id}>
              <button onClick={() => toggle(f.id)} className={cn('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition', picked.has(f.id) ? 'bg-accent/15 ring-1 ring-accent/50' : 'hover:bg-white/5')} aria-pressed={picked.has(f.id)} data-pick-friend={f.username}>
                <Avatar name={f.username} src={f.avatar} frame={f.style?.frame} size="sm" status={f.status.state} />
                <UserName name={f.username} style={f.style} verified={f.verified} admin={f.admin} className="min-w-0 flex-1 text-sm font-semibold" />
                <span className={cn('flex size-5 items-center justify-center rounded-md border', picked.has(f.id) ? 'border-accent bg-accent text-white' : 'border-border')}>{picked.has(f.id) && <Check className="size-3.5" />}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

/** Who's in a group, renaming it, adding friends, removing people (the owner), leaving. */
export function GroupSettingsDialog({ group, onClose }: { group: GroupChat; onClose: () => void }): React.JSX.Element {
  const account = useAccount()
  const friends = useFriends()?.friends ?? []
  const toast = useToast()
  const [name, setName] = useState(group.name)
  const [busy, setBusy] = useState<string | null>(null)
  const me = group.members.find((m) => m.username === account?.username)?.id ?? ''
  const owner = group.ownerId === me
  const inGroup = new Set(group.members.map((m) => m.id))
  const addable = friends.filter((f) => !inGroup.has(f.id))

  const run = async (key: string, fn: () => Promise<{ error?: string }>, ok?: string): Promise<boolean> => {
    setBusy(key)
    const r = await fn().catch(() => ({ error: 'Check your connection and try again.' }))
    setBusy(null)
    if (r.error !== undefined) {
      toast(r.error, 'error')
      return false
    }
    if (ok) toast(ok)
    await refreshGroups()
    return true
  }

  return (
    <Dialog title={group.name} description={`${group.members.length} of ${MAX_GROUP_SIZE} people`} onClose={onClose}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() && name.trim() !== group.name) void run('rename', () => window.vanity.groups.rename(group.id, name.trim()), 'Group renamed')
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, MAX_GROUP_NAME))} aria-label="Group name" className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-4 text-sm outline-none focus:border-accent" data-rename-group />
        <Button type="submit" disabled={!name.trim() || name.trim() === group.name || busy !== null}>
          Rename
        </Button>
      </form>

      <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-widest text-muted">In the group</p>
      <ul className="space-y-1">
        {group.members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
            <Avatar name={m.username} src={m.avatar} size="sm" />
            <UserName name={m.username} style={m.style as never} verified={m.verified} admin={m.admin} className="min-w-0 flex-1 text-sm font-semibold" />
            {m.id === group.ownerId && <Crown className="size-4 text-amber-300" aria-label="Made the group" />}
            {m.id === me && <span className="text-xs text-muted">You</span>}
            {owner && m.id !== me && (
              <button onClick={() => void run(`rm${m.id}`, () => window.vanity.groups.remove(group.id, m.id), `${m.username} removed`)} disabled={busy !== null} className="rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-accent" aria-label={`Remove ${m.username}`} title="Remove from the group">
                <UserMinus className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {addable.length > 0 && group.members.length < MAX_GROUP_SIZE && (
        <>
          <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-widest text-muted">Add a friend</p>
          <ul className="max-h-48 space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
            {addable.map((f) => (
              <li key={f.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                <Avatar name={f.username} src={f.avatar} size="sm" status={f.status.state} />
                <UserName name={f.username} style={f.style} verified={f.verified} admin={f.admin} className="min-w-0 flex-1 text-sm" />
                <Button onClick={() => void run(`add${f.id}`, () => window.vanity.groups.add(group.id, f.id), `${f.username} added`)} disabled={busy !== null} data-add-to-group={f.username}>
                  {busy === `add${f.id}` ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />} Add
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Button
        className="mt-6 w-full justify-center text-accent"
        disabled={busy !== null}
        onClick={async () => {
          if (await run('leave', () => window.vanity.groups.remove(group.id, 'me'), `You left ${group.name}`)) {
            closeChat(groupChatId(group.id))
            onClose()
          }
        }}
        data-leave-group
      >
        <LogOut className="size-4" /> Leave the group
      </Button>
    </Dialog>
  )
}
