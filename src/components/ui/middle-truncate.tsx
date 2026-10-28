const TAIL = 10
const MIN_WORD_TAIL = 4
const MAX_WORD_TAIL = 16
const WORD_BREAK = /[-_./]/

/**
 * Splits a slug-like value so its tail always stays visible. The tail starts
 * on a word ("…machine", not "…er-machine") when a break is near the cut.
 * Returns null when the value is too short to need a split.
 */
export function splitForMiddleTruncate(
  value: string
): { head: string; tail: string } | null {
  const chars = Array.from(value)
  if (chars.length <= TAIL + 4) return null

  const startsWord = (index: number) => WORD_BREAK.test(chars[index - 1] ?? '')
  let cut = chars.length - TAIL
  if (!startsWord(cut)) {
    // Prefer a shorter tail so the head keeps more room; a longer tail is the fallback.
    let snapped = -1
    for (let i = cut + 1; i <= chars.length - MIN_WORD_TAIL; i++) {
      if (startsWord(i)) {
        snapped = i
        break
      }
    }
    for (
      let i = cut - 1;
      snapped < 0 && i >= chars.length - MAX_WORD_TAIL && i > 4;
      i--
    ) {
      if (startsWord(i)) snapped = i
    }
    if (snapped > 0) cut = snapped
  }

  return { head: chars.slice(0, cut).join(''), tail: chars.slice(cut).join('') }
}

/** Truncates in the middle with CSS: the head gets the ellipsis, the tail stays. */
export function MiddleTruncate({ text }: { text: string }) {
  const split = splitForMiddleTruncate(text)
  if (!split) return <span className="truncate">{text}</span>
  return (
    <span className="flex min-w-0">
      <span className="truncate">{split.head}</span>
      <span className="shrink-0 whitespace-pre">{split.tail}</span>
    </span>
  )
}
