import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import { defaultUIState, type UIState } from '@/types/ui-state'

import { getClientId } from '@/lib/client-session'
import { hasBackend, hasBackendTransport, isNativeApp } from '@/lib/environment'
import { preserveQueryCacheOnError } from '@/lib/query-error'
import { getActiveRemoteConnection } from '@/lib/remote-connections'
import {
  drainInputDraftChanges,
  requeueInputDraftChanges,
} from '@/lib/input-draft-sync'
import {
  scopeUIStateResources,
  unscopeUIStateResources,
} from '@/lib/ui-state-resources'

const isTauri = hasBackend

// Query keys for UI state
export const uiStateQueryKeys = {
  all: ['ui-state'] as const,
  state: () => [...uiStateQueryKeys.all] as const,
}

const SAVE_TIMEOUT_MS = 10_000

function withSaveTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('UI state save timed out')),
      SAVE_TIMEOUT_MS
    )
  })
  return Promise.race([promise, timeout])
    .catch(error => {
      logger.warn('UI state save failed or timed out', { error })
      throw error
    })
    .finally(() => clearTimeout(timer))
}

async function saveUIStateNow(uiState: UIState): Promise<UIState> {
  // Skip persistence when running outside Tauri (e.g., bun run dev in browser)
  if (!isTauri()) {
    logger.debug('Not in Tauri context, UI state not persisted to disk', {
      uiState,
    })
    return uiState
  }

  const draftChanges = drainInputDraftChanges()
  try {
    logger.debug('Saving UI state to backend', { uiState })
    const remote = isNativeApp() ? getActiveRemoteConnection() : null
    const clientId = await getClientId()

    // The backend merges this page's draft edits into the drafts on disk under
    // its UI-state write lock, so a stale tab cannot resurrect a draft another
    // tab already sent and cleared (#33), even across tabs. If the save fails,
    // the draft changes are requeued.
    const changes: UIState = {
      ...uiState,
      input_drafts: Object.fromEntries(
        [...draftChanges].map(([id, text]) => [id, text ?? ''])
      ),
    }
    const outgoing = remote ? unscopeUIStateResources(changes, remote.id) : null
    const stateToSave = remote
      ? unscopeUIStateResources(uiState, remote.id)
      : uiState
    // The timeout lives inside this try so a hung save still requeues.
    const written = await withSaveTimeout(
      invoke<Record<string, string>>('save_ui_state_with_draft_changes', {
        uiState: stateToSave,
        clientId,
        draftChanges: outgoing ? outgoing.input_drafts : changes.input_drafts,
      })
    )
    logger.debug('UI state saved successfully')
    const drafts = remote
      ? (scopeUIStateResources({ ...uiState, input_drafts: written }, remote.id)
          .input_drafts ?? {})
      : written
    return { ...uiState, input_drafts: drafts }
  } catch (error) {
    requeueInputDraftChanges(draftChanges)
    // Silent fail for UI state saves - don't bother user with errors
    logger.error('Failed to save UI state', { error, uiState })
    throw error
  }
}

// TanStack Query hooks following the architectural patterns
export function useUIState() {
  return useQuery({
    queryKey: uiStateQueryKeys.state(),
    queryFn: async (): Promise<UIState> => {
      // Return defaults when running outside Tauri (e.g., bun run dev in browser)
      if (!hasBackendTransport()) {
        logger.debug('Not in Tauri context, using default UI state')
        return defaultUIState
      }

      try {
        logger.debug('Loading UI state from backend')
        const clientId = await getClientId()
        const uiState = await invoke<UIState>('load_ui_state', { clientId })
        const remote = isNativeApp() ? getActiveRemoteConnection() : null
        const restoredState = remote
          ? scopeUIStateResources(uiState, remote.id)
          : uiState
        logger.info('UI state loaded successfully', { uiState: restoredState })
        return restoredState
      } catch (error) {
        // Return defaults if UI state file doesn't exist yet
        logger.warn('Failed to load UI state, using defaults', { error })
        return preserveQueryCacheOnError(error)
      }
    },
    staleTime: Infinity, // UI state doesn't need refetching - only updates via setQueryData
    gcTime: 1000 * 60 * 60, // 1 hour
  })
}

// Saves run one at a time so each drains its own batch of draft changes and
// a failed or timed-out save requeues them before the next one starts.
let saveQueue: Promise<unknown> = Promise.resolve()

export function useSaveUIState() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (uiState: UIState): Promise<UIState> => {
      const run = saveQueue.then(() => saveUIStateNow(uiState))
      saveQueue = run.catch(() => undefined)
      return run
    },
    onSuccess: saved => {
      // Update the cache with the new UI state. Saves never change pins; they
      // change only through set_recent_session_pinned.
      queryClient.setQueryData<UIState>(uiStateQueryKeys.state(), current => ({
        ...saved,
        pinned_recent_session_ids: current?.pinned_recent_session_ids,
      }))
      logger.debug('UI state cache updated')
      // No toast for UI state - silent operation
    },
  })
}
