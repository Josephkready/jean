import { forwardRef, type SVGProps } from 'react'

type AgentsIconProps = SVGProps<SVGSVGElement> & {
  size?: string | number
}

/** Line-art agent: a speech bubble with eyes and a spark. */
export const AgentsIcon = forwardRef<SVGSVGElement, AgentsIconProps>(
  ({ size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* Speech-bubble body with a tail */}
      <path d="M11 4.5H8.5a5 5 0 0 0-5 5v4a5 5 0 0 0 5 5h.5v3l4-3h2.5a5 5 0 0 0 5-5v-1" />
      {/* Eyes */}
      <path d="M9.5 10.75v1.5M14.5 10.75v1.5" strokeWidth="2.25" />
      {/* Spark: the agent is alive and working */}
      <path d="M19 1.75c.3 1.85 1.15 2.7 3 3-1.85.3-2.7 1.15-3 3-.3-1.85-1.15-2.7-3-3 1.85-.3 2.7-1.15 3-3Z" />
    </svg>
  )
)

AgentsIcon.displayName = 'AgentsIcon'
