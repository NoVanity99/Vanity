import { useCallback, useRef } from 'react'

const MAX_DEG = 7

/**
 * 3D tilt toward the cursor plus a moving glare. Writes CSS variables straight
 * to the element (no React re-render on mouse move). Respects reduced motion.
 */
export function useTilt<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>
  onMouseMove: (e: React.MouseEvent) => void
  onMouseLeave: () => void
} {
  const ref = useRef<T>(null)
  const frame = useRef(0)
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const el = ref.current
      if (!el || reduced) return
      const { clientX, clientY } = e
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        const x = (clientX - r.left) / r.width
        const y = (clientY - r.top) / r.height
        el.style.setProperty('--tilt-x', `${((0.5 - y) * MAX_DEG * 2).toFixed(2)}deg`)
        el.style.setProperty('--tilt-y', `${((x - 0.5) * MAX_DEG * 2).toFixed(2)}deg`)
        el.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`)
        el.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`)
      })
    },
    [reduced]
  )

  const onMouseLeave = useCallback(() => {
    cancelAnimationFrame(frame.current)
    const el = ref.current
    if (!el) return
    el.style.setProperty('--tilt-x', '0deg')
    el.style.setProperty('--tilt-y', '0deg')
  }, [])

  return { ref, onMouseMove, onMouseLeave }
}
