import { forwardRef, type SVGProps } from 'react'

type AgentsIconProps = SVGProps<SVGSVGElement> & {
  size?: string | number
}

/** Line-art agent face (antenna, eyes, smile), matching the pixel-art AgentIcon mascot. */
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
      {/* Antenna */}
      <circle cx="12" cy="2.75" r="1.25" />
      <path d="M12 4v2.5" />
      {/* Head */}
      <rect x="3.75" y="6.5" width="16.5" height="13.5" rx="4.5" />
      {/* Ears */}
      <path d="M1.75 11.5v3M22.25 11.5v3" />
      {/* Eyes */}
      <path d="M9 11.25v1.5M15 11.25v1.5" strokeWidth="2.25" />
      {/* Smile */}
      <path d="M9.25 15.75c1.5 1.25 4 1.25 5.5 0" />
    </svg>
  )
)

AgentsIcon.displayName = 'AgentsIcon'
