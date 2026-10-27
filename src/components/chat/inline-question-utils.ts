/** Cue from the inline-question prompt ("Reply with a number:"). */
const REPLY_CUE_RE =
  /\breply with (?:a|the|one) (?:number|option)\b[^.:?!\n]*[.:]?/i
const ITEM_RE = /^\s{0,3}(\d{1,2})[.)]\s+(.+?)\s*$/
const MAX_OPTIONS = 8

export interface InlineQuestion {
  /** Last line before the list, without the cue */
  question: string
  options: string[]
  /** The text without the cue and the numbered list */
  rest: string
}

interface NumberedList {
  start: number
  end: number
  options: string[]
}

function plain(text: string): string {
  return text
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/, '')
    .trim()
}

/** Index of the nearest non-blank line from `from` in `step` direction. */
function nearestLine(lines: string[], from: number, step: 1 | -1): number {
  for (let i = from; i >= 0 && i < lines.length; i += step) {
    if (lines[i]?.trim()) return i
  }
  return -1
}

/**
 * Question that a backend asked as text: "Reply with a number:" next to a
 * numbered list of 2 to 8 options. Uses the last such list. Null when the
 * text has no such question.
 */
export function parseInlineNumberedQuestion(
  text: string
): InlineQuestion | null {
  const lines = text.split('\n')
  let found: NumberedList | null = null
  let current: NumberedList | null = null

  const closeList = () => {
    if (!current || current.options.length < 2) return
    const before = nearestLine(lines, current.start - 1, -1)
    const after = nearestLine(lines, current.end + 1, 1)
    const cued = [before, after].some(
      i => i >= 0 && REPLY_CUE_RE.test(lines[i] ?? '')
    )
    if (cued) found = current
  }

  for (const [index, line] of lines.entries()) {
    const item = ITEM_RE.exec(line)
    if (!item) {
      // Blank lines and indented continuation lines stay inside a list
      if (line.trim() && !/^\s{2,}\S/.test(line)) {
        closeList()
        current = null
      }
      continue
    }
    const number = Number(item[1])
    if (number === 1) {
      closeList()
      current = { start: index, end: index, options: [] }
    }
    if (current && number === current.options.length + 1) {
      current.options.push(plain(item[2] ?? ''))
      current.end = index
    } else {
      closeList()
      current = null
    }
  }
  closeList()

  const list = found as NumberedList | null
  if (!list || list.options.length > MAX_OPTIONS) return null
  if (new Set(list.options).size !== list.options.length) return null

  // Drop the list and the cue; keep text that shares a line with the cue
  const withoutCue = (line: string) => line.replace(REPLY_CUE_RE, '').trimEnd()
  const kept = lines
    .filter((_, index) => index < list.start || index > list.end)
    .map(withoutCue)
  const question = lines
    .slice(0, list.start)
    .map(line => plain(withoutCue(line)))
    .reverse()
    .find(Boolean)

  return {
    question: question ?? 'Choose an option',
    options: list.options,
    rest: kept
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  }
}

/** User reply for a picked option: its number and text. */
export function inlineQuestionAnswer(options: string[], index: number): string {
  return `${index + 1}. ${options[index] ?? ''}`
}
