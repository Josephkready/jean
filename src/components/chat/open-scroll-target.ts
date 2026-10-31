/**
 * Opening a finished chat should land on the top of the latest recap (or the
 * top of the latest answer) instead of the bottom, so the reader does not have
 * to scroll back up through a long recap on every visit (issue #26).
 */

/** Attribute set on the wrapper of the latest, finished assistant answer. */
export const OPEN_SCROLL_ANCHOR_ATTR = 'data-open-scroll-anchor'

const OPEN_SCROLL_PADDING_PX = 8
const RECAP_HEADING_TEXT_RE = /^recap$/i

/**
 * Pick the element to scroll to: the `Recap` heading inside the latest answer
 * when present, otherwise the top of the answer itself.
 */
export function findOpenScrollAnchor(root: ParentNode): HTMLElement | null {
  const anchors = root.querySelectorAll<HTMLElement>(
    `[${OPEN_SCROLL_ANCHOR_ATTR}]`
  )
  const answer = anchors.item(anchors.length - 1)
  if (!answer) return null
  const headings = answer.querySelectorAll<HTMLElement>('h1, h2, h3')
  for (const heading of Array.from(headings).reverse()) {
    if (RECAP_HEADING_TEXT_RE.test(heading.textContent?.trim() ?? '')) {
      return heading
    }
  }
  return answer
}

interface OpenScrollInput {
  /** Anchor top relative to the viewport top (anchorRect.top - viewportRect.top). */
  anchorOffsetTop: number
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

/**
 * ScrollTop that puts the anchor at the top of the viewport, clamped to the
 * scrollable range. Returns null when the chat does not overflow.
 */
export function computeOpenScrollTop({
  anchorOffsetTop,
  scrollTop,
  clientHeight,
  scrollHeight,
}: OpenScrollInput): number | null {
  const maxScroll = scrollHeight - clientHeight
  if (maxScroll <= 0) return null
  const target = scrollTop + anchorOffsetTop - OPEN_SCROLL_PADDING_PX
  return Math.min(Math.max(0, Math.round(target)), maxScroll)
}

/**
 * Scroll the viewport to the latest recap/answer top. Returns the new scrollTop
 * or null when there is no anchor or nothing to scroll.
 */
export function scrollToLatestAnswerTop(viewport: HTMLElement): number | null {
  const anchor = findOpenScrollAnchor(viewport)
  if (!anchor) return null
  const top = computeOpenScrollTop({
    anchorOffsetTop:
      anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
    scrollTop: viewport.scrollTop,
    clientHeight: viewport.clientHeight,
    scrollHeight: viewport.scrollHeight,
  })
  if (top == null) return null
  viewport.scrollTop = top
  return top
}
