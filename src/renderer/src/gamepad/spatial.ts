/** Directional ("spatial") navigation: which element is next in a direction, by on-screen position. */

export type Direction = 'up' | 'down' | 'left' | 'right'

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const center = (b: Box): { x: number; y: number } => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 })

/**
 * Index of the best candidate in `dir` from `from`, or -1. Prefers elements
 * that line up with the current one (overlapping rows/columns), then the
 * closest along the direction of travel.
 */
export function pickNext(from: Box, candidates: Box[], dir: Direction): number {
  const c = center(from)
  let best = -1
  let bestScore = Infinity
  candidates.forEach((b, i) => {
    let primary: number
    let overlap: boolean
    let ortho: number
    const bc = center(b)
    if (dir === 'right' || dir === 'left') {
      primary = dir === 'right' ? b.left - from.right : from.left - b.right
      // Must actually be in that direction (allow a little overlap).
      if ((dir === 'right' ? bc.x <= c.x : bc.x >= c.x) || primary < -Math.min(from.right - from.left, b.right - b.left) / 2) return
      overlap = b.top < from.bottom && b.bottom > from.top
      ortho = Math.abs(bc.y - c.y)
    } else {
      primary = dir === 'down' ? b.top - from.bottom : from.top - b.bottom
      if ((dir === 'down' ? bc.y <= c.y : bc.y >= c.y) || primary < -Math.min(from.bottom - from.top, b.bottom - b.top) / 2) return
      overlap = b.left < from.right && b.right > from.left
      ortho = Math.abs(bc.x - c.x)
    }
    const score = Math.max(0, primary) + (overlap ? 0 : 1000 + ortho * 2) + ortho * 0.3
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}
