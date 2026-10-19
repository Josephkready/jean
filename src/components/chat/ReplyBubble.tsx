import type { ReactNode } from 'react'

/** Agent chat reply: the same bubble as a user prompt, aligned left. */
export function ReplyBubble({ children }: { children: ReactNode }) {
  return (
    <div className="w-fit max-w-full min-w-0 break-words [overflow-wrap:anywhere] rounded-lg border border-border bg-muted/20 px-3 py-2 text-foreground sm:max-w-[85%]">
      {children}
    </div>
  )
}
