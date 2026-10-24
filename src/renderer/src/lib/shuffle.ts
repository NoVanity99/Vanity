/** 0..count-1 in random order (Fisher–Yates). */
export function shuffledIndices(count: number, random = Math.random): number[] {
  const order = Array.from({ length: count }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}
