import type { UiPrefs } from '@shared/ui'

/** What moves behind the whole interface: drifting glows, a brighter aurora, a cyber grid or a starfield. */
export function AmbientBackground({ kind = 'glow' }: { kind?: UiPrefs['background'] }): React.JSX.Element | null {
  if (kind === 'none') return null
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
      {(kind === 'glow' || kind === 'aurora' || kind === 'stars') && (
        <>
          <div
            className="aurora-blob"
            style={{ width: '55vw', height: '55vw', left: '15%', top: '-25%', background: 'var(--color-accent)', animation: 'aurora-a 28s ease-in-out infinite', opacity: kind === 'aurora' ? 0.3 : undefined }}
          />
          <div
            className="aurora-blob"
            style={{ width: '45vw', height: '45vw', right: '-10%', bottom: '-20%', background: 'var(--color-accent-2)', animation: 'aurora-b 34s ease-in-out infinite', opacity: kind === 'aurora' ? 0.3 : undefined }}
          />
        </>
      )}
      {kind === 'aurora' && (
        <div className="aurora-blob" style={{ width: '40vw', height: '40vw', left: '-12%', bottom: '5%', background: '#22d3ee', animation: 'aurora-b 22s ease-in-out infinite', opacity: 0.2 }} />
      )}
      {kind === 'grid' && <div className="bg-grid" />}
      {kind === 'stars' && <div className="bg-stars" />}
    </div>
  )
}
