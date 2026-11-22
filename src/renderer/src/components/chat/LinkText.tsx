import { Fragment } from 'react'

// A web address: http(s)://… or www.… up to the next space. Trailing punctuation is left out.
const URL = /\b((?:https?:\/\/|www\.)[^\s<>"'`]+)/gi

/** Splits text into plain parts and web addresses. Exported for tests. */
export function splitLinks(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = []
  let at = 0
  for (const m of text.matchAll(URL)) {
    let url = m[0]
    // "…example.com)." : the closing bracket and full stop belong to the sentence.
    while (/[.,!?;:)\]}'"]$/.test(url) && !(url.endsWith(')') && url.split('(').length > url.split(')').length - 1 && url.includes('('))) url = url.slice(0, -1)
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
    try {
      const parsed = new globalThis.URL(href)
      if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes('.')) continue
    } catch {
      continue
    }
    if (m.index > at) parts.push({ text: text.slice(at, m.index) })
    parts.push({ text: url, href })
    at = m.index + url.length
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return parts
}

/**
 * Message text with its web addresses made clickable. A link opens in your web browser
 * (never inside Vanity). Only http and https addresses become links.
 */
export function LinkText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {splitLinks(text).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noreferrer noopener" title={`Open ${p.href} in your browser`} className="break-all underline decoration-current/50 underline-offset-2 transition hover:decoration-current" data-chat-link onClick={(e) => e.stopPropagation()}>
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  )
}
