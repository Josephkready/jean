import { createElement, type PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIState } from '@/types/ui-state'
import {
  resetInputDraftChangesForTests,
  trackInputDraftChanges,
} from '@/lib/input-draft-sync'

vi.mock('@/lib/environment', () => ({
  isNativeApp: () => false,
  hasBackend: () => true,
  hasBackendTransport: () => true,
}))
vi.mock('@/lib/client-session', () => ({
  getClientId: async () => 'client-1',
}))
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }))
vi.mock('@/lib/transport', () => ({ invoke: mockInvoke }))

import { useSaveUIState } from './ui-state'

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(QueryClientProvider, { client: new QueryClient() }, children)

function state(input_drafts: Record<string, string>): UIState {
  return { version: 1, input_drafts } as UIState
}

describe('useSaveUIState input drafts (#33)', () => {
  let onDisk: Record<string, string>
  let saved: UIState | null

  beforeEach(() => {
    resetInputDraftChangesForTests()
    saved = null
    mockInvoke.mockReset()
    mockInvoke.mockImplementation(
      async (cmd: string, args: { uiState: UIState }) => {
        if (cmd === 'load_ui_state') return state(onDisk)
        if (cmd === 'save_ui_state') {
          saved = args.uiState
          onDisk = args.uiState.input_drafts ?? {}
        }
        return null
      }
    )
  })

  it('does not resurrect a draft that another tab already sent and cleared', async () => {
    // Tab A cleared the draft on send; disk has no draft for s1.
    onDisk = {}
    // This (stale) tab still holds the mid-typing draft it restored at load,
    // but never changed it.
    const { result } = renderHook(() => useSaveUIState(), { wrapper })
    await result.current.mutateAsync(
      state({ s1: 'Can we look at recently opened issues and ' })
    )
    expect(saved?.input_drafts).toEqual({})
  })

  it('persists drafts this page typed and clears the ones it cleared', async () => {
    onDisk = { s1: 'old', s2: 'keep' }
    trackInputDraftChanges({ s1: 'old', s2: 'keep' }, { s2: 'keep', s3: 'new' })
    const { result } = renderHook(() => useSaveUIState(), { wrapper })
    await result.current.mutateAsync(state({ s2: 'keep', s3: 'new' }))
    expect(saved?.input_drafts).toEqual({ s2: 'keep', s3: 'new' })
  })
})
