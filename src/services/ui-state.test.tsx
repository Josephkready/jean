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

  // Emulates the backend: drafts on disk + this page's changes ('' = cleared).
  function backend(cmd: string, args: Record<string, unknown>) {
    if (cmd === 'save_ui_state_with_draft_changes') {
      const merged = { ...onDisk }
      for (const [id, text] of Object.entries(
        args.draftChanges as Record<string, string>
      )) {
        if (text === '') Reflect.deleteProperty(merged, id)
        else merged[id] = text
      }
      onDisk = merged
      saved = { ...(args.uiState as UIState), input_drafts: merged }
      return merged
    }
    return null
  }

  beforeEach(() => {
    resetInputDraftChangesForTests()
    saved = null
    mockInvoke.mockReset()
    mockInvoke.mockImplementation(async (cmd: string, args: never) =>
      backend(cmd, args)
    )
  })

  it('does not resurrect a draft that another tab already sent and cleared', async () => {
    // Tab A cleared the draft on send; disk has no draft for s1.
    onDisk = {}
    // This (stale) tab still holds the mid-typing draft it restored at load,
    // but never changed it, so it sends no draft changes.
    const { result } = renderHook(() => useSaveUIState(), { wrapper })
    await result.current.mutateAsync(
      state({ s1: 'Can we look at recently opened issues and ' })
    )
    expect(saved?.input_drafts).toEqual({})
    expect(mockInvoke).toHaveBeenCalledWith(
      'save_ui_state_with_draft_changes',
      expect.objectContaining({ draftChanges: {} })
    )
  })

  it('persists drafts this page typed and clears the ones it cleared', async () => {
    onDisk = { s1: 'old', s2: 'keep' }
    trackInputDraftChanges({ s1: 'old', s2: 'keep' }, { s2: 'keep', s3: 'new' })
    const { result } = renderHook(() => useSaveUIState(), { wrapper })
    await result.current.mutateAsync(state({ s2: 'keep', s3: 'new' }))
    expect(saved?.input_drafts).toEqual({ s2: 'keep', s3: 'new' })
  })

  it('requeues draft changes when the save fails so a later save retries them', async () => {
    onDisk = {}
    trackInputDraftChanges({}, { s1: 'typed' })
    mockInvoke.mockRejectedValueOnce(new Error('write failed'))
    const { result } = renderHook(() => useSaveUIState(), { wrapper })
    await expect(
      result.current.mutateAsync(state({ s1: 'typed' }))
    ).rejects.toThrow('write failed')
    await result.current.mutateAsync(state({ s1: 'typed' }))
    expect(saved?.input_drafts).toEqual({ s1: 'typed' })
  })

  it('times out a hung save, requeues its draft changes, and lets the next save retry', async () => {
    onDisk = {}
    trackInputDraftChanges({}, { s1: 'typed' })
    mockInvoke.mockImplementationOnce(() => new Promise(() => undefined))
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useSaveUIState(), { wrapper })
      const hung = result.current.mutateAsync(state({ s1: 'typed' }))
      const assertion = expect(hung).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
    const { result } = renderHook(() => useSaveUIState(), { wrapper })
    await result.current.mutateAsync(state({ s1: 'typed' }))
    expect(saved?.input_drafts).toEqual({ s1: 'typed' })
  })
})
