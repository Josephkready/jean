import { CircleHelp } from '@/components/icons/reicon'
import { inlineQuestionAnswer } from './inline-question-utils'

/**
 * Numbered question that the assistant asked as text, with its options as
 * buttons. A click sends "N. option" as the next user message.
 */
export function InlineQuestionOptions({
  question,
  options,
  disabled,
  onSend,
}: {
  question: string
  options: string[]
  disabled: boolean
  onSend: (text: string) => void
}) {
  return (
    <section
      aria-label="Question"
      className="mt-3 flex flex-col items-start gap-2"
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <CircleHelp className="size-3.5" />
        Question
      </div>
      <p className="text-sm font-medium text-foreground">{question}</p>
      <div className="flex max-w-full flex-col items-start gap-1.5">
        {options.map((option, index) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onSend(inlineQuestionAnswer(options, index))}
            className="flex max-w-full items-start gap-2.5 rounded-md bg-muted/60 px-3 py-2 text-left text-sm text-foreground transition-colors enabled:cursor-pointer enabled:hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-background/60 text-xs font-medium tabular-nums text-muted-foreground">
              {index + 1}.
            </span>
            <span className="min-w-0 flex-1">{option}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
