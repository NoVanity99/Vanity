import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flag, Loader2, MessageSquareText, MoreHorizontal, Pencil, SendHorizontal, Trash2 } from 'lucide-react'
import type { PublicUser } from '@shared/types'
import { Avatar } from '@/components/Avatar'
import { LinkText } from '@/components/chat/LinkText'
import { Button, Dialog } from '@/components/Dialog'
import { UserName } from '@/components/UserName'
import { cn } from '@/lib/cn'
import { formatAgo } from '@/lib/format'
import { useAccount } from '@/state/account'
import { useToast } from '@/state/toasts'

const MAX = 1000

interface Comment {
  id: number
  user: PublicUser
  text: string
  at: number | null
  editedAt: number | null
  mine: boolean
}
type Page = { comments: Comment[]; hasMore: boolean; total: number }

/**
 * The comments under a game: one thread that everyone with that game sees. Newest first, more
 * load as you scroll. You can edit and delete your own, and report someone else's.
 */
export function GameComments({ gameId }: { gameId: number }): React.JSX.Element | null {
  const account = useAccount()
  const toast = useToast()
  const navigate = useNavigate()
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [total, setTotal] = useState(0)
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [menu, setMenu] = useState<number | null>(null)
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null)
  const [reporting, setReporting] = useState<Comment | null>(null)
  const [reason, setReason] = useState('')
  const sentinel = useRef<HTMLDivElement>(null)
  const base = `/games/~${gameId}/comments`
  const signedIn = !!account?.username

  const load = useCallback(
    async (before?: number): Promise<void> => {
      setLoading(true)
      const r = await window.vanity.account.request<Page>('GET', `${base}${before ? `?before=${before}` : ''}`).catch(() => null)
      setLoading(false)
      if (!r || r.error !== undefined) return setError(r?.error ?? "Couldn't load the comments. Check your connection.")
      setError(null)
      setTotal(r.data.total)
      setMore(r.data.hasMore)
      setComments((prev) => {
        if (!before) return r.data.comments
        const have = new Set((prev ?? []).map((c) => c.id))
        return [...(prev ?? []), ...r.data.comments.filter((c) => !have.has(c.id))]
      })
    },
    [base]
  )

  useEffect(() => {
    setComments(null)
    setText('')
    setEditing(null)
    if (signedIn) void load()
  }, [gameId, signedIn, load])

  // More load when the end of the list scrolls into view.
  const last = comments?.[comments.length - 1]?.id
  useEffect(() => {
    const el = sentinel.current
    if (!el || !more || !last) return
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && !loading && void load(last), { rootMargin: '200px' })
    seen.observe(el)
    return () => seen.disconnect()
  }, [more, last, loading, load])

  // Close the little menu when clicking elsewhere.
  useEffect(() => {
    if (menu === null) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  if (!account?.available) return null

  const post = async (): Promise<void> => {
    const body = text.trim()
    if (!body || posting) return
    setPosting(true)
    const r = await window.vanity.account.request<{ comment: Comment }>('POST', base, { text: body }).catch(() => null)
    setPosting(false)
    if (!r || r.error !== undefined) return toast(r?.error ?? "Couldn't post that. Check your connection.", 'error')
    setText('')
    setTotal((t) => t + 1)
    setComments((prev) => [r.data.comment, ...(prev ?? [])])
  }
  const saveEdit = async (): Promise<void> => {
    if (!editing) return
    const r = await window.vanity.account.request<{ comment: Comment }>('PATCH', `/comments/${editing.id}`, { text: editing.text.trim() }).catch(() => null)
    if (!r || r.error !== undefined) return toast(r?.error ?? "Couldn't save that.", 'error')
    setComments((prev) => (prev ?? []).map((c) => (c.id === editing.id ? r.data.comment : c)))
    setEditing(null)
  }
  const remove = async (c: Comment): Promise<void> => {
    const r = await window.vanity.account.request('DELETE', `/comments/${c.id}`).catch(() => null)
    if (!r || r.error !== undefined) return toast(r?.error ?? "Couldn't delete that.", 'error')
    setComments((prev) => (prev ?? []).filter((x) => x.id !== c.id))
    setTotal((t) => Math.max(0, t - 1))
    toast('Comment deleted')
  }
  const length = [...text.trim()].length

  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface p-6 max-md:p-4" data-game-comments>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <MessageSquareText className="size-5 text-accent" /> Comments
        {total > 0 && <span className="text-sm font-normal text-muted">{total.toLocaleString()}</span>}
      </h2>
      <p className="mt-0.5 text-xs text-muted">Everyone on Vanity who has this game sees the same comments.</p>

      {!signedIn ? (
        <p className="mt-4 text-sm text-muted">Log in to read and write comments.</p>
      ) : (
        <>
          <form
            className="mt-4 flex items-start gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void post()
            }}
          >
            <Avatar name={account.username ?? '?'} src={account.avatar} frame={account.style.frame} size="md" />
            <div className="min-w-0 flex-1">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void post()
                }}
                rows={text.includes('\n') || text.length > 90 ? 3 : 1}
                placeholder="Say something about this game…"
                aria-label="Write a comment"
                className="w-full resize-none rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
                data-comment-box
              />
              {(text || length > 0) && (
                <div className="mt-2 flex items-center gap-3">
                  <span className={cn('text-xs tabular-nums', length > MAX ? 'font-semibold text-accent' : 'text-muted')}>
                    {length}/{MAX}
                  </span>
                  <Button type="submit" variant="primary" className="ml-auto" disabled={!length || length > MAX || posting} data-comment-post>
                    {posting ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />} Post
                  </Button>
                </div>
              )}
            </div>
          </form>

          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
              {error}
            </p>
          )}
          {comments === null && !error ? (
            <div className="flex h-24 items-center justify-center text-muted">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : comments && comments.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted">No comments yet. Be the first.</p>
          ) : (
            <ul className="mt-5 space-y-4" data-comment-list>
              {comments?.map((c) => (
                <li key={c.id} className="group flex items-start gap-3" data-comment={c.id} data-comment-mine={c.mine}>
                  <button onClick={() => (c.mine ? navigate('/profile') : navigate(`/friends/${c.user.id}`))} title={`Open ${c.user.username}'s profile`} className="shrink-0">
                    <Avatar name={c.user.username} src={c.user.avatar} frame={c.user.style?.frame} size="md" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <UserName name={c.user.username} style={c.user.style} verified={c.user.verified} admin={c.user.admin} className="font-bold" />
                      <time className="text-xs text-muted" title={c.at ? new Date(c.at).toLocaleString() : undefined} dateTime={c.at ? new Date(c.at).toISOString() : undefined}>
                        {formatAgo(c.at)}
                        {c.editedAt ? ' · edited' : ''}
                      </time>
                    </p>
                    {editing?.id === c.id ? (
                      <div className="mt-1.5">
                        <textarea value={editing.text} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} rows={3} autoFocus aria-label="Edit your comment" className="w-full resize-none rounded-xl border border-accent bg-surface-2 px-3 py-2 text-sm outline-none" data-comment-edit-box />
                        <div className="mt-1.5 flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                          <Button variant="primary" disabled={!editing.text.trim() || [...editing.text.trim()].length > MAX} onClick={() => void saveEdit()} data-comment-save>
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-text/90" data-comment-text>
                        <LinkText text={c.text} />
                      </p>
                    )}
                  </div>
                  <div className="relative shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenu(menu === c.id ? null : c.id)
                      }}
                      aria-label="Comment options"
                      className="rounded-lg p-1.5 text-muted opacity-0 transition hover:bg-white/8 hover:text-text focus:opacity-100 group-hover:opacity-100 max-md:opacity-100"
                      data-comment-menu
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                    {menu === c.id && (
                      <div className="absolute right-0 top-8 z-20 w-40 animate-pop-in overflow-hidden rounded-xl border border-border bg-surface-2 py-1 text-sm shadow-2xl" role="menu">
                        {c.mine && (
                          <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/8" onClick={() => setEditing({ id: c.id, text: c.text })} data-comment-edit>
                            <Pencil className="size-3.5" /> Edit
                          </button>
                        )}
                        {(c.mine || account.admin) && (
                          <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-accent hover:bg-white/8" onClick={() => void remove(c)} data-comment-delete>
                            <Trash2 className="size-3.5" /> Delete
                          </button>
                        )}
                        {!c.mine && (
                          <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/8" onClick={() => (setReason(''), setReporting(c))} data-comment-report>
                            <Flag className="size-3.5" /> Report
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div ref={sentinel} className="h-1" />
          {loading && comments && (
            <div className="flex justify-center py-3 text-muted">
              <Loader2 className="size-4 animate-spin" />
            </div>
          )}
        </>
      )}

      {reporting && (
        <Dialog
          title="Report this comment?"
          description={`From ${reporting.user.username}. Vanity's admins will look at it.`}
          onClose={() => setReporting(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setReporting(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  const r = await window.vanity.account.request('POST', `/comments/${reporting.id}/report`, { reason }).catch(() => null)
                  setReporting(null)
                  if (!r || r.error !== undefined) toast(r?.error ?? "Couldn't send the report.", 'error')
                  else toast('Reported. Thanks for telling us.')
                }}
                data-report-send
              >
                <Flag className="size-4" /> Report
              </Button>
            </>
          }
        >
          <div className="space-y-3 p-6">
            <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-text/85">{reporting.text.slice(0, 300)}</p>
            <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} placeholder="What's wrong with it? (optional)" aria-label="Reason" className="h-10 w-full rounded-xl border border-border bg-surface-2 px-4 text-sm outline-none focus:border-accent" />
          </div>
        </Dialog>
      )}
    </section>
  )
}
