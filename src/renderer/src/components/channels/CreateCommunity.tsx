import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Hash, Loader2, X } from 'lucide-react'
import { LIMITS, TEMPLATES, tidyName, VISIBILITIES, type CommunityDetail, type Template, type Visibility } from '@shared/communities'
import { Button } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import { api, refreshCommunities } from '@/state/communities'
import { BannerPicker, CommunityCardView, IconPicker, VISIBILITY_ICON } from './bits'

const field = 'w-full rounded-xl border border-border bg-surface-2 px-4 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15'

/**
 * "Create Channel", in three steps: pick a starting point, set it up, look it over.
 * (What is being made is a community: the thing people see as a Channel.)
 */
export function CreateCommunity({ onClose, onCreated }: { onClose: () => void; onCreated: (c: CommunityDetail) => void }): React.JSX.Element {
  const [step, setStep] = useState(1)
  const [template, setTemplate] = useState<Template>(TEMPLATES[0])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [banner, setBanner] = useState('default')
  const [visibility, setVisibility] = useState<Visibility>('open')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clean = tidyName(name, LIMITS.communityName)
  const ready = [...clean].length >= 2

  const create = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ community: CommunityDetail }>('POST', '', { name: clean, description: tidyName(description, LIMITS.description), icon, banner, visibility, template: template.id })
      await refreshCommunities()
      onCreated(r.community)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create it.")
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-[fade-in_150ms_ease-out] items-center justify-center bg-black/70 p-6 backdrop-blur-md max-md:p-3" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()} data-create-community={step}>
      <div role="dialog" aria-label="Create a Channel" className="flex max-h-full w-full max-w-2xl animate-[dialog-in_200ms_ease-out] flex-col overflow-hidden rounded-3xl border border-white/10 bg-surface shadow-2xl shadow-black/60">
        <header className="relative shrink-0 px-7 pb-4 pt-6 text-center">
          <button onClick={onClose} disabled={busy} aria-label="Close" className="absolute right-4 top-4 rounded-lg p-1.5 text-muted transition hover:bg-white/8 hover:text-text">
            <X className="size-5" />
          </button>
          <h2 className="font-display text-2xl font-black">{step === 1 ? 'Create your Channel' : step === 2 ? 'Make it yours' : 'Looking good'}</h2>
          <p className="mt-1 text-sm text-muted">{step === 1 ? 'A Channel is your own space, with channels inside for talking. Pick a starting point.' : step === 2 ? 'Give it a name and a face. You can change all of this later.' : "This is how it will look. Create it when you're happy."}</p>
          <div className="mx-auto mt-4 flex w-40 gap-1.5" aria-label={`Step ${step} of 3`}>
            {[1, 2, 3].map((n) => (
              <span key={n} className={cn('h-1 flex-1 rounded-full transition-colors duration-300', n <= step ? 'bg-accent' : 'bg-white/10')} />
            ))}
          </div>
        </header>

        <div key={step} className="pane-in thin-scroll min-h-0 flex-1 overflow-y-auto px-7 pb-2">
          {step === 1 && (
            <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1" role="radiogroup" aria-label="Starting point">
              {TEMPLATES.map((t) => (
                <button key={t.id} role="radio" aria-checked={template.id === t.id} onClick={() => setTemplate(t)} onDoubleClick={() => (setTemplate(t), setStep(2))} className={cn('group rounded-2xl border p-4 text-left transition duration-200 hover:-translate-y-0.5', template.id === t.id ? 'border-accent bg-accent/10 shadow-lg shadow-accent/10 ring-2 ring-accent/30' : 'border-border bg-surface-2/60 hover:border-white/25')} data-template={t.id}>
                  <span className="flex items-center gap-3">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-black/30 text-2xl transition group-hover:scale-110">{t.emoji}</span>
                    <span className="min-w-0">
                      <span className="block font-display font-bold">{t.label}</span>
                      <span className="block text-xs text-muted">{t.hint}</span>
                    </span>
                  </span>
                  <span className="mt-3 block space-y-1.5 border-t border-white/8 pt-3">
                    {t.categories.map((c) => (
                      <span key={c.name} className="block text-[11px] text-muted">
                        <span className="font-bold uppercase tracking-wider text-text/70">{c.name}</span> · {c.channels.join(', ')}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <IconPicker name={clean} icon={icon} onChange={setIcon} />
              <div>
                <label htmlFor="community-name" className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-muted">Name</label>
                <input id="community-name" className={cn(field, 'h-11')} value={name} onChange={(e) => setName(e.target.value.slice(0, LIMITS.communityName * 2))} placeholder="Night Owls 🦉" autoFocus maxLength={LIMITS.communityName * 2} data-community-name />
              </div>
              <div>
                <label htmlFor="community-description" className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-widest text-muted">
                  Description <span className="font-normal normal-case tracking-normal">{[...description].length}/{LIMITS.description}</span>
                </label>
                <textarea id="community-description" className={cn(field, 'resize-none py-2.5')} rows={2} value={description} onChange={(e) => setDescription([...e.target.value].slice(0, LIMITS.description).join(''))} placeholder="What is it about? (optional)" data-community-description />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted">Banner</p>
                <BannerPicker value={banner} onChange={setBanner} />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted">Who can find it</p>
                <div className="grid gap-2" role="radiogroup" aria-label="Who can find it">
                  {VISIBILITIES.map((v) => {
                    const Icon = VISIBILITY_ICON[v.id]
                    return (
                      <button key={v.id} type="button" role="radio" aria-checked={visibility === v.id} onClick={() => setVisibility(v.id)} className={cn('flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition', visibility === v.id ? 'border-accent bg-accent/10 ring-2 ring-accent/30' : 'border-border hover:border-white/25')} data-visibility-option={v.id}>
                        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', visibility === v.id ? 'bg-accent text-white' : 'bg-white/8 text-muted')}>
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-bold">{v.label}</span>
                          <span className="block text-xs text-muted">{v.hint}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid grid-cols-[15rem_1fr] gap-5 max-md:grid-cols-1" data-create-preview>
              <CommunityCardView c={{ id: 'preview', name: clean || 'Your Channel', description: tidyName(description, LIMITS.description), icon, banner, visibility, members: 1, online: 1, role: 'owner', requested: false, unread: 0 }} />
              <div className="rounded-2xl border border-border bg-surface-2/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted">It starts with these channels</p>
                <div className="mt-3 space-y-3">
                  {template.categories.map((c) => (
                    <div key={c.name}>
                      <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted">
                        <ChevronDown className="size-3" /> {c.name}
                      </p>
                      {c.channels.map((ch) => (
                        <p key={ch} className="ml-2 mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-text/85">
                          <Hash className="size-3.5 text-muted" /> {ch}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-muted">You'll be the Owner. {VISIBILITIES.find((v) => v.id === visibility)?.hint}</p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mx-7 mt-2 animate-pop-in rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
            {error}
          </p>
        )}
        <footer className="flex shrink-0 items-center gap-2 px-7 py-5">
          {step > 1 && (
            <Button onClick={() => (setError(null), setStep(step - 1))} disabled={busy} data-create-back>
              <ArrowLeft className="size-4" /> Back
            </Button>
          )}
          {step < 3 ? (
            <Button variant="primary" className="ml-auto h-10 px-5" disabled={step === 2 && !ready} onClick={() => setStep(step + 1)} data-create-next>
              Next <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button variant="primary" className="ml-auto h-10 px-6" disabled={busy || !ready} onClick={() => void create()} data-create-finish>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Create Channel
            </Button>
          )}
        </footer>
      </div>
    </div>,
    document.body
  )
}
