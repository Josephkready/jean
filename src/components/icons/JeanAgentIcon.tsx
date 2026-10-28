import type { SVGProps } from 'react'

/**
 * Agent colors: [head, shadow, bubble]. `jean` is the crowned boss.
 * Bubble is a vivid shade that fills the user's prompt bubbles (white text).
 */
export const AGENT_ICON_COLORS = {
  jean: ['#FFD21F', '#8A6500', '#EB9500'],
  yellow: ['#FFD21F', '#8A6500', '#EB9500'],
  blue: ['#4DA6FF', '#1A4F99', '#2B7FFF'],
  green: ['#3DDC84', '#16733F', '#00B248'],
  pink: ['#FF6EB4', '#99285E', '#F6339A'],
  purple: ['#A57BFF', '#4B2A99', '#8E51FF'],
  orange: ['#FF9A3D', '#994400', '#FF6A00'],
} as const

export type AgentIconKey = keyof typeof AGENT_ICON_COLORS

interface AgentIconProps extends SVGProps<SVGSVGElement> {
  icon?: string
}

/** Pixel-art agent face. Jean wears a crown; other agents have an antenna. */
export function AgentIcon({ icon = 'yellow', ...props }: AgentIconProps) {
  const [head, shadow] =
    AGENT_ICON_COLORS[icon as AgentIconKey] ?? AGENT_ICON_COLORS.yellow
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      {...props}
    >
      {icon === 'jean' ? (
        // Crown
        <path fill="#F59E0B" d="M3 1h1v1h1v1h2V1h2v2h2V2h1V1h1v3H3z" />
      ) : (
        // Antenna
        <path fill={shadow} d="M7 1h2v1H7zM7.5 2h1v2h-1z" />
      )}
      {/* Shadow */}
      <path fill={shadow} d="M14 5h1v10H3v-1h11z" />
      {/* Head */}
      <rect x="2" y="4" width="12" height="10" fill={head} />
      {/* Eyes */}
      <path fill="#3F3416" d="M5 7h1v2H5zM10 7h1v2h-1z" />
      {/* Cheeks */}
      <path fill="#F59E9E" d="M3 10h2v1H3zM11 10h2v1h-2z" />
      {/* Smile */}
      <path fill="#3F3416" d="M6 10h1v1H6zM9 10h1v1H9zM7 11h2v1H7z" />
    </svg>
  )
}

/** Pixel-art Jean coordinator: a smiling face with a boss crown. */
export function JeanAgentIcon(props: SVGProps<SVGSVGElement>) {
  return <AgentIcon icon="jean" {...props} />
}
