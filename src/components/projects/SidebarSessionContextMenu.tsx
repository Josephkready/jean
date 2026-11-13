import { useRef, useState, type ReactNode } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { SessionContextMenuItems } from '@/components/chat/SessionContextMenuItems'
import { useOpenInNativeClient } from '@/components/chat/hooks/useOpenInNativeClient'
import { getResumeCommand } from '@/components/chat/session-card-utils'
import { reconnectNativeCliSession } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import type { Session } from '@/types/chat'

interface SidebarSessionContextMenuProps {
  session: Session
  worktreeId: string
  worktreePath: string
  onRename: (session: Session) => void
  onLabel: (sessionId: string) => void
  onArchive: (session: Session) => void
  onDelete: (session: Session) => void
  children: ReactNode
}

/** Sidebar session rows use the same menu as the worktree session tabs. */
export function SidebarSessionContextMenu({
  children,
  onRename,
  ...props
}: SidebarSessionContextMenuProps) {
  const [open, setOpen] = useState(false)
  const suppressCloseAutoFocusRef = useRef(false)
  return (
    <ContextMenu onOpenChange={setOpen}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {open && (
        <SidebarSessionContextMenuContent
          {...props}
          onRename={session => {
            suppressCloseAutoFocusRef.current = true
            onRename(session)
          }}
          onCloseAutoFocus={e => {
            if (suppressCloseAutoFocusRef.current) {
              e.preventDefault()
              suppressCloseAutoFocusRef.current = false
            }
          }}
        />
      )}
    </ContextMenu>
  )
}

// Mounted only while open so collapsed rows don't run per-row hooks.
function SidebarSessionContextMenuContent({
  session,
  worktreeId,
  worktreePath,
  onRename,
  onLabel,
  onArchive,
  onDelete,
  onCloseAutoFocus,
}: Omit<SidebarSessionContextMenuProps, 'children'> & {
  onCloseAutoFocus: (event: Event) => void
}) {
  const hasLabel = useChatStore(state => !!state.sessionLabels[session.id])
  const { openInNativeClient, isPending } = useOpenInNativeClient(
    worktreeId,
    worktreePath
  )
  const resumeCommand = getResumeCommand(session)

  return (
    <ContextMenuContent className="w-64" onCloseAutoFocus={onCloseAutoFocus}>
      <SessionContextMenuItems
        session={session}
        hasLabel={hasLabel}
        resumeCommand={resumeCommand}
        nativeClientPending={isPending}
        onRename={() => onRename(session)}
        onToggleLabel={() => onLabel(session.id)}
        onOpenInNativeClient={() => openInNativeClient(session)}
        onReconnect={() => void reconnectNativeCliSession(session, worktreeId)}
        onArchive={() => onArchive(session)}
        onDelete={() => onDelete(session)}
      />
    </ContextMenuContent>
  )
}
