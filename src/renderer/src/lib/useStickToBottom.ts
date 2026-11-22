import { useEffect, type RefObject } from 'react'

/**
 * Keeps a chat on its newest message.
 *
 * Setting the scroll position once, when the messages arrive, isn't enough: pictures and GIFs
 * load afterwards and make the list taller, and a chat that was hidden and is shown again comes
 * back scrolled to the top (the browser forgets where a hidden list was). So this also watches
 * for those two things:
 *  - the list changing size, or something inside it finishing loading: back to the bottom, if
 *    that is where you were (`atBottom`);
 *  - the list appearing after being hidden: always to the bottom, wherever it was left.
 *
 * `atBottom` is the same flag the chat keeps from its own scroll handler, so someone who has
 * scrolled up to read is left alone.
 */
export function useStickToBottom(box: RefObject<HTMLElement | null>, atBottom: { current: boolean }, resetKey: unknown): void {
  useEffect(() => {
    const el = box.current
    if (!el) return
    let shown = el.clientHeight > 0
    const pin = (): void => {
      if (atBottom.current) el.scrollTop = el.scrollHeight
    }
    const sized = (): void => {
      const now = el.clientHeight > 0
      // Opened again after being hidden: start at the newest message.
      if (now && !shown) atBottom.current = true
      shown = now
      pin()
    }
    const observer = new ResizeObserver(sized)
    observer.observe(el)
    // "load" doesn't bubble, so it is caught on the way down.
    el.addEventListener('load', pin, true)
    // A moment later too, for anything that settled without telling us (fonts, the first layout).
    const soon = requestAnimationFrame(pin)
    return () => {
      observer.disconnect()
      el.removeEventListener('load', pin, true)
      cancelAnimationFrame(soon)
    }
  }, [box, atBottom, resetKey])
}
