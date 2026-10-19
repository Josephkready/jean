import type { ReactNode } from 'react'

/** Borderless pill bubble shared by agent chat replies and prompts. */
export const PILL_BUBBLE_CLASS =
  'min-w-0 break-words [overflow-wrap:anywhere] rounded-[22px] bg-muted px-4 py-2.5 text-foreground'

/** Agent chat reply: a pill bubble, aligned left. */
export function ReplyBubble({ children }: { children: ReactNode }) {
  return (
    <div className={`w-fit max-w-full sm:max-w-[85%] ${PILL_BUBBLE_CLASS}`}>
      {children}
    </div>
  )
}
