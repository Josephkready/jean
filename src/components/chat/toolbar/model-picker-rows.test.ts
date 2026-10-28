import { describe, expect, it } from 'vitest'
import {
  buildClaudeAccountRows,
  buildFavoriteRows,
  getClaudeAccountNames,
  isClaudeAccountProfile,
  modelKey,
  parseModelKey,
} from './model-picker-rows'

describe('model keys', () => {
  it('round-trips plain, account, and colon-containing model keys', () => {
    for (const [backend, model, account] of [
      ['codex', 'gpt-5.5', null],
      ['claude', 'claude-opus-4-8[1m]', 'Work'],
      ['opencode', 'ollama/qwen3:32b', null],
      ['claude', 'opus', 'Work Team'],
    ] as const) {
      expect(parseModelKey(modelKey(backend, model, account))).toEqual({
        backend,
        model,
        account,
      })
    }
    expect(modelKey('claude', 'opus', null)).toBe('claude:opus')
    expect(parseModelKey('no-colon')).toBeNull()
  })

  it('round-trips account names containing ":" and "@"', () => {
    const account = 'a:b@c'
    expect(parseModelKey(modelKey('claude', 'opus:x', account))).toEqual({
      backend: 'claude',
      model: 'opus:x',
      account,
    })
  })
})

describe('isClaudeAccountProfile', () => {
  it('needs a non-empty CLAUDE_CONFIG_DIR in valid JSON', () => {
    const profile = (settings_json: string) => ({ name: 'p', settings_json })
    expect(
      isClaudeAccountProfile(profile('{"env":{"CLAUDE_CONFIG_DIR":"/a"}}'))
    ).toBe(true)
    expect(
      isClaudeAccountProfile(profile('{"env":{"CLAUDE_CONFIG_DIR":" "}}'))
    ).toBe(false)
    expect(
      isClaudeAccountProfile(profile('{"env":{"ANTHROPIC_BASE_URL":"x"}}'))
    ).toBe(false)
    expect(isClaudeAccountProfile(profile('not json'))).toBe(false)
  })
})

describe('getClaudeAccountNames', () => {
  it('drops account names containing colons so favorite keys stay parseable', () => {
    const profile = (name: string) => ({
      name,
      settings_json: '{"env":{"CLAUDE_CONFIG_DIR":"/a"}}',
    })
    expect(getClaudeAccountNames([profile('Work'), profile('a:b')])).toEqual([
      'Work',
    ])
    expect(parseModelKey(modelKey('claude', 'opus', 'Work Team'))).toEqual({
      backend: 'claude',
      model: 'opus',
      account: 'Work Team',
    })
  })
})

describe('buildFavoriteRows', () => {
  const sections = [
    { backend: 'claude' as const, options: [{ value: 'opus', label: 'Opus' }] },
    { backend: 'codex' as const, options: [{ value: 'gpt', label: 'GPT' }] },
  ]
  const claudeOptions = [{ value: 'opus', label: 'Opus 5.5' }]

  it('keeps favorite order and skips uninstalled backends and deleted accounts', () => {
    const rows = buildFavoriteRows(
      [
        'codex:gpt',
        'pi:pi/x',
        'claude@Gone:opus',
        'claude@Work:opus',
        'claude:opus',
      ],
      sections,
      ['Work'],
      claudeOptions
    )
    expect(rows).toEqual([
      { backend: 'codex', value: 'gpt', label: 'GPT' },
      {
        backend: 'claude',
        value: 'opus',
        label: 'Work · Opus 5.5',
        account: 'Work',
      },
      {
        backend: 'claude',
        value: 'opus',
        label: 'Default · Opus 5.5',
        account: null,
      },
    ])
  })

  it('shows plain Claude favorites without accounts and drops account ones', () => {
    const rows = buildFavoriteRows(
      ['claude:opus', 'claude@Work:opus', 'codex:unknown-model'],
      sections,
      [],
      claudeOptions
    )
    expect(rows).toEqual([
      { backend: 'claude', value: 'opus', label: 'Opus' },
      { backend: 'codex', value: 'unknown-model', label: 'unknown-model' },
    ])
  })
})

describe('buildClaudeAccountRows', () => {
  it('puts every account next to each other for each model', () => {
    const rows = buildClaudeAccountRows(
      [
        { value: 'opus', label: 'Opus' },
        { value: 'haiku', label: 'Haiku' },
      ],
      ['Work']
    )
    expect(rows.map(row => [row.label, row.account])).toEqual([
      ['Default · Opus', null],
      ['Work · Opus', 'Work'],
      ['Default · Haiku', null],
      ['Work · Haiku', 'Work'],
    ])
  })
})
