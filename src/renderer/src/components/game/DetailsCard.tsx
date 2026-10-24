import { useState } from 'react'
import { ChevronDown, Cpu, ExternalLink, Info } from 'lucide-react'
import type { Game, GameDetails } from '@shared/types'
import { cn } from '@/lib/cn'
import { Chip, Section } from './parts'

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element | null {
  if (children === null || children === undefined || children === '' || (Array.isArray(children) && children.length === 0)) return null
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 select-text">{children}</dd>
    </div>
  )
}

function Chips({ items }: { items: string[] }): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Chip key={i}>{i}</Chip>
      ))}
    </div>
  )
}

const LANGUAGES_SHOWN = 6

export function DetailsCard({ game, details, delay }: { game: Game; details: GameDetails | null; delay?: number }): React.JSX.Element {
  const [allLanguages, setAllLanguages] = useState(false)
  const d = details
  const languages = d?.languages ?? []
  const developers = d?.developers.length ? d.developers : game.developer ? [game.developer] : []
  const release = game.releaseDate
    ? new Date(`${game.releaseDate}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null
  const age = game.releaseDate ? Math.floor((Date.now() - Date.parse(game.releaseDate)) / (365.25 * 86_400_000)) : null

  return (
    <Section icon={Info} title="Details" delay={delay}>
      <dl className="-my-2 divide-y divide-white/5">
        <Row label="Developer">{developers.join(', ')}</Row>
        <Row label="Publisher">{d?.publishers.join(', ')}</Row>
        <Row label="Released">{release && `${release}${age !== null && age >= 1 ? ` · ${age} year${age === 1 ? '' : 's'} ago` : ''}`}</Row>
        <Row label="Series">{d?.franchise}</Row>
        <Row label="Price">{d?.price}</Row>
        <Row label="Achievements">{d?.achievements ? d.achievements.toLocaleString() : null}</Row>
        <Row label="DLC">{d?.dlcCount ? `${d.dlcCount} add-on${d.dlcCount === 1 ? '' : 's'}` : null}</Row>
        <Row label="Modes">{d?.modes.length ? <Chips items={d.modes} /> : null}</Row>
        <Row label="Perspective">{d?.perspectives.length ? <Chips items={d.perspectives} /> : null}</Row>
        <Row label="Themes">{d?.themes.length ? <Chips items={d.themes} /> : null}</Row>
        <Row label="Platforms">{d?.platforms.length ? d.platforms.join(', ') : null}</Row>
        <Row label="Languages">
          {languages.length > 0 && (
            <>
              {(allLanguages ? languages : languages.slice(0, LANGUAGES_SHOWN)).join(', ')}
              {languages.length > LANGUAGES_SHOWN && (
                <button className="ml-1.5 text-xs font-medium text-accent hover:underline" onClick={() => setAllLanguages((v) => !v)}>
                  {allLanguages ? 'Show fewer' : `+${languages.length - LANGUAGES_SHOWN} more`}
                </button>
              )}
            </>
          )}
        </Row>
        <Row label="Features">{d?.features.length ? <Chips items={d.features} /> : null}</Row>
        <Row label="Website">
          {d?.website && (
            <a href={d.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              {new URL(d.website).hostname.replace(/^www\./, '')} <ExternalLink className="size-3" />
            </a>
          )}
        </Row>
      </dl>
      {!d && <div className="shimmer mt-3 h-24 rounded-xl bg-white/[0.03]" />}
    </Section>
  )
}

/** PC system requirements from Steam, folded away by default. */
export function Requirements({ req, delay }: { req: NonNullable<GameDetails['requirements']>; delay?: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <Section
      icon={Cpu}
      title="System requirements"
      delay={delay}
      action={
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-text" aria-expanded={open}>
          {open ? 'Hide' : 'Show'} <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      }
    >
      {open ? (
        <div className="grid gap-5 text-sm">
          {(['minimum', 'recommended'] as const).map((k) =>
            req[k] ? (
              <div key={k}>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{k === 'minimum' ? 'Minimum' : 'Recommended'}</h3>
                <p className="select-text whitespace-pre-line leading-relaxed text-text/80">{req[k]}</p>
              </div>
            ) : null
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">What your PC needs to run it{req.recommended ? ', minimum and recommended' : ''}.</p>
      )}
    </Section>
  )
}
