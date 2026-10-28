import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { CustomCliProfile } from '@/types/preferences'
import { useToolbarDerivedState } from './useToolbarDerivedState'
import { getClaudeCatalogOptions } from './model-picker-rows'

vi.mock('@/services/model-catalog', () => ({
  useModelCatalog: () => ({ data: undefined }),
  getCatalogModelOptions: () => [],
  getCatalogModelFastInfo: () => ({ isFast: false, baseModel: '' }),
  getCatalogModelReasoning: () => undefined,
}))

const accountProfile = {
  name: 'josephkready',
  settings_json: JSON.stringify({
    env: { CLAUDE_CONFIG_DIR: '~/.claude-accounts/josephkready' },
  }),
} as unknown as CustomCliProfile

const apiProfile = {
  name: 'routing',
  settings_json: JSON.stringify({
    env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k2' },
  }),
} as unknown as CustomCliProfile

function claudeOptions(
  selectedProvider: string | null,
  customCliProfiles: CustomCliProfile[]
) {
  const { result } = renderHook(() =>
    useToolbarDerivedState({
      selectedBackend: 'claude',
      selectedProvider,
      selectedModel: 'opus',
      customCliProfiles,
    })
  )
  return result.current.claudeModelOptions
}

describe('useToolbarDerivedState claudeModelOptions provider branch', () => {
  it('uses the Anthropic catalog when no provider is selected', () => {
    expect(claudeOptions(null, [])).toEqual(getClaudeCatalogOptions(undefined))
  })

  it('uses the Anthropic catalog for an account profile, not aliases', () => {
    const options = claudeOptions('josephkready', [accountProfile])
    expect(options).toEqual(getClaudeCatalogOptions(undefined))
    expect(options.map(option => option.value)).not.toContain('opus')
  })

  it('keeps the Opus/Sonnet/Haiku alias list for an API routing profile', () => {
    expect(claudeOptions('routing', [apiProfile])).toEqual([
      { value: 'opus', label: 'Opus (kimi-k2)' },
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'haiku', label: 'Haiku' },
    ])
  })
})
