import type { AgentQuestion } from '@/components/agents/agent-messages'
import { stripRecapFromText } from './recap-utils'

/** Cue from the inline-question fallback prompt ("reply with a number"). */
const REPLY_CUE_RE = /\breply with (?:a|the|one) (?:number|option)\b/i
const ITEM_RE = /^\s{0,3}(\d{1,2})[.)]\s+(.+?)\s*$/
const MAX_OPTIONS = 8

interface NumberedList {
  start: number
  options: string[]
}

function plain(text: string): string {
  return text
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/, '')
    .trim()
}

/**
 * Question that a backend asked as text when it had no native question tool:
 * a numbered list (1, 2, 3...) plus "reply with a number". Uses the last such
 * list outside the recap. Null when the text has no such question.
 */
export function parseInlineNumberedQuestion(
  text: string
): AgentQuestion | null {
  if (!REPLY_CUE_RE.test(text)) return null
  const lines = stripRecapFromText(text).split('\n')

  let found: NumberedList | null = null
  let current: NumberedList | null = null
  for (const [index, line] of lines.entries()) {
    const item = ITEM_RE.exec(line)
    if (!item) {
      // Blank lines and indented continuation lines stay inside a list
      if (line.trim() && !/^\s{2,}\S/.test(line)) current = null
      continue
    }
    const number = Number(item[1])
    if (number === 1) current = { start: index, options: [] }
    if (current && number === current.options.length + 1) {
      current.options.push(plain(item[2] ?? ''))
      if (current.options.length >= 2) found = current
    } else {
      current = null
    }
  }

  if (!found || found.options.length > MAX_OPTIONS) return null
  if (new Set(found.options).size !== found.options.length) return null

  // The question is the last line before the list, without the cue
  const question = lines
    .slice(0, found.start)
    .reverse()
    .map(line =>
      plain(line)
        .replace(new RegExp(`${REPLY_CUE_RE.source}[^.:?!]*[.:]?`, 'i'), '')
        .trim()
    )
    .find(Boolean)
  return {
    question: question ?? 'Choose an option',
    options: found.options,
    multiple: false,
  }
}

/** User reply for a picked option: its number and text. */
export function inlineQuestionAnswer(
  question: AgentQuestion,
  option: string
): string {
  return `${question.options.indexOf(option) + 1}. ${option}`
}
