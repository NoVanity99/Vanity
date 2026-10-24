import { useEffect, useState } from 'react'

/**
 * The cover's most vivid colour, for tinting the game page. Samples a tiny
 * copy of the image and averages its saturated pixels, weighted by saturation.
 */
export function useCoverTint(src: string | null): string | null {
  const [tint, setTint] = useState<string | null>(null)

  useEffect(() => {
    setTint(null)
    if (!src) return
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      try {
        const size = 24
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)
        let r = 0
        let g = 0
        let b = 0
        let weight = 0
        for (let i = 0; i < data.length; i += 4) {
          const [pr, pg, pb] = [data[i], data[i + 1], data[i + 2]]
          const max = Math.max(pr, pg, pb)
          const min = Math.min(pr, pg, pb)
          const sat = max === 0 ? 0 : (max - min) / max
          const light = max / 255
          // Prefer colourful mid-to-bright pixels over greys and near-blacks.
          const w = sat * sat * (light > 0.15 ? 1 : 0.1)
          r += pr * w
          g += pg * w
          b += pb * w
          weight += w
        }
        if (weight < 1) return
        const hex = (n: number): string => Math.round(Math.min(255, n / weight)).toString(16).padStart(2, '0')
        setTint(`#${hex(r)}${hex(g)}${hex(b)}`)
      } catch {
        // A cross-origin image we can't read: no tint.
      }
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [src])

  return tint
}
