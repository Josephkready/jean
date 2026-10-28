import { renderHook } from '@testing-library/react'
import type * as ReactQuery from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useUsageEntries } from './usage-entries'

const mocks = vi.hoisted(() => ({
  claudeStatus: { data: { installed: true } },
  claudeAuth: { data: { authenticated: false } },
  claudeUsage: { data: undefined as unknown },
  preferences: { data: { custom_cli_profiles: [] as unknown[] } },
  accountQueries: [] as unknown[],
}))

vi.mock('@/services/claude-cli', () => ({
  claudeUsageQueryOptions: vi.fn((opts: unknown) => opts),
  useClaudeCliAuth: () => mocks.claudeAuth,
  useClaudeCliStatus: () => mocks.claudeStatus,
  useClaudeUsage: () => mocks.claudeUsage,
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => mocks.preferences,
}))

vi.mock('@/services/codex-cli', () => ({
  useCodexCliAuth: () => ({ data: { authenticated: false } }),
  useCodexCliStatus: () => ({ data: { installed: false } }),
  useCodexUsage: () => ({ data: undefined }),
}))

vi.mock('@/services/grok-cli', () => ({
  useGrokCliAuth: () => ({ data: { authenticated: false } }),
  useGrokCliStatus: () => ({ data: { installed: false } }),
  useGrokUsage: () => ({ data: undefined }),
}))

vi.mock('@tanstack/react-query', async importOriginal => {
  const actual = await importOriginal<typeof ReactQuery>()
  return {
    ...actual,
    useQueries: ({
      queries,
    }: {
      queries: { account: string; enabled: boolean }[]
    }) =>
      queries.map(q => ({
        data: undefined,
        account: q.account,
        enabled: q.enabled,
      })),
  }
})

describe('useUsageEntries account rows', () => {
  beforeEach(() => {
    mocks.claudeStatus = { data: { installed: true } }
    mocks.claudeAuth = { data: { authenticated: false } }
    mocks.preferences = {
      data: {
        custom_cli_profiles: [
          {
            name: 'josephkready',
            settings_json: '{"env":{"CLAUDE_CONFIG_DIR":"/home/u/.claude-j"}}',
          },
          {
            name: 'minimax',
            settings_json: '{"env":{"ANTHROPIC_BASE_URL":"https://x"}}',
          },
        ],
      },
    }
  })

  it('adds one entry per account profile with a unique key', () => {
    const { result } = renderHook(() => useUsageEntries(true))
    const keys = result.current.map(entry => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('claude:josephkready')
    expect(keys).not.toContain('claude:minimax')
    const entry = result.current.find(e => e.key === 'claude:josephkready')
    expect(entry?.label).toBe('Claude · josephkready')
  })

  it('keeps account entries available when the default login is unauthenticated', () => {
    const { result } = renderHook(() => useUsageEntries(true))
    expect(result.current.map(entry => entry.key)).not.toContain('claude')
    expect(result.current.map(entry => entry.key)).toContain(
      'claude:josephkready'
    )
  })
})
