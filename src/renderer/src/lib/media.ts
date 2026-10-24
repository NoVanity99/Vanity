/** URL for a locally cached image (served by the vanity-media:// protocol from stage 5). */
export function mediaUrl(path: string | null): string | null {
  return path ? `vanity-media://local/${encodeURIComponent(path)}` : null
}

/** A stable hue per game name, for placeholder art until real artwork is downloaded. */
export function nameHue(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}
