/** Two slowly drifting blurred glows in the theme's accent colours, behind the whole interface. */
export function AmbientBackground(): React.JSX.Element {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
      <div
        className="aurora-blob"
        style={{ width: '55vw', height: '55vw', left: '15%', top: '-25%', background: 'var(--color-accent)', animation: 'aurora-a 28s ease-in-out infinite' }}
      />
      <div
        className="aurora-blob"
        style={{ width: '45vw', height: '45vw', right: '-10%', bottom: '-20%', background: 'var(--color-accent-2)', animation: 'aurora-b 34s ease-in-out infinite' }}
      />
    </div>
  )
}
