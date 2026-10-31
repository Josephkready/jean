import { toast } from 'sonner'
import { invoke } from '@/lib/transport'
import { copyToClipboard } from '@/lib/clipboard'
import { useChatStore } from '@/store/chat-store'

/** Mirror of Rust `SessionInfo` (camelCase, see jean-core chat/session_info.rs). */
export interface SessionInfo {
  sessionId: string
  name: string
  backend: string
  model?: string | null
  backendSessionId?: string | null
  worktreePath: string
  transcriptPaths: string[]
  runLogDir?: string | null
}

/** Plain-text block another agent can read to find the session's context. */
export function formatSessionInfo(info: SessionInfo): string {
  const lines = [`Jean session: ${info.name} (${info.sessionId})`]
  const model = info.model ? ` (${info.model})` : ''
  lines.push(
    info.backendSessionId
      ? `Backend: ${info.backend}${model} session id: ${info.backendSessionId}`
      : `Backend: ${info.backend}${model} (no backend session id yet)`
  )
  if (info.worktreePath) lines.push(`Worktree: ${info.worktreePath}`)
  for (const path of info.transcriptPaths) lines.push(`Transcript: ${path}`)
  if (info.runLogDir) lines.push(`Jean run logs: ${info.runLogDir}`)
  return lines.join('\n')
}

/** Resolve a session's ids and transcript paths on the backend, then copy them. */
export async function copySessionInfo(
  sessionId: string,
  worktreePath?: string | null
): Promise<void> {
  try {
    const info = await invoke<SessionInfo>('get_session_info', {
      sessionId,
      worktreePath: worktreePath ?? null,
    })
    await copyToClipboard(formatSessionInfo(info))
    toast.success('Session info copied')
  } catch (error) {
    toast.error(`Failed to copy session info: ${error}`)
  }
}

/** Copy info for the active session of a worktree (Magic menu / mobile menu). */
export async function copyActiveSessionInfo(
  worktreeId: string | null | undefined
): Promise<void> {
  const sessionId = worktreeId
    ? useChatStore.getState().activeSessionIds[worktreeId]
    : undefined
  if (!sessionId) {
    toast.error('No active session')
    return
  }
  await copySessionInfo(sessionId)
}
