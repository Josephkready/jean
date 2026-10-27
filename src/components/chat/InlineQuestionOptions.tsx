import { inlineQuestionAnswer } from './inline-question-utils'

/**
 * Clickable options of a numbered question that the assistant asked as text.
 * A click sends "N. option" as the next user message.
 */
export function InlineQuestionOptions({
  title,
  options,
  disabled,
  onSend,
}: {
  /** Shown only when the question is not already visible above */
  title?: string
  options: string[]
  disabled: boolean
  onSend: (text: string) => void
}) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {title && <p className="text-sm font-medium text-foreground">{title}</p>}
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onSend(inlineQuestionAnswer(options, index))}
          className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-left text-sm text-foreground transition-colors enabled:hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
        >
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {index + 1}.
          </span>
          <span className="min-w-0 flex-1">{option}</span>
        </button>
      ))}
    </div>
  )
}
