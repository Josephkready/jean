import type { CliBackend, CustomCliProfile } from '@/types/preferences'
import {
  getCatalogModelOptions,
  type ModelCatalog,
} from '@/services/model-catalog'

export interface ModelOption {
  value: string
  label: string
}

/**
 * One row in the model picker. `account` is only set for Claude rows when the
 * picker shows accounts: `null` is the default `~/.claude` login, a string is
 * the name of an account profile.
 */
export interface PickerRow extends ModelOption {
  backend: CliBackend
  account?: string | null
}

export const DEFAULT_ACCOUNT_LABEL = 'Default'

/** Favorite / row key: `backend:model`, or `backend@account:model` for accounts. */
export function modelKey(
  backend: CliBackend,
  model: string,
  account?: string | null
): string {
  return account ? `${backend}@${account}:${model}` : `${backend}:${model}`
}

export function parseModelKey(
  key: string
): { backend: CliBackend; model: string; account: string | null } | null {
  // Backend ids never contain ':' or '@'; models can contain ':' (opencode tags).
  const match = /^([a-z0-9_-]+)(?:@([^:]+))?:(.+)$/.exec(key)
  if (!match) return null
  const [, backend, account, model] = match
  if (!backend || !model) return null
  return { backend: backend as CliBackend, model, account: account ?? null }
}

/**
 * A Claude CLI profile that sets `CLAUDE_CONFIG_DIR` is a separate Claude
 * login (account), not an API routing provider.
 */
export function isClaudeAccountProfile(profile: CustomCliProfile): boolean {
  try {
    const dir = JSON.parse(profile.settings_json)?.env?.CLAUDE_CONFIG_DIR
    return typeof dir === 'string' && dir.trim().length > 0
  } catch {
    return false
  }
}

export function getClaudeAccountNames(profiles: CustomCliProfile[]): string[] {
  return profiles.filter(isClaudeAccountProfile).map(profile => profile.name)
}

export function getClaudeCatalogOptions(
  catalog: ModelCatalog | null | undefined
): ModelOption[] {
  return getCatalogModelOptions(catalog, 'claude').map(option => ({
    ...option,
    label: option.label.replace(/^Claude\s+/, ''),
  }))
}

export function accountRowLabel(account: string | null, label: string): string {
  return `${account ?? DEFAULT_ACCOUNT_LABEL} · ${label}`
}

/** One row per Claude model and account, accounts side by side per model. */
export function buildClaudeAccountRows(
  options: ModelOption[],
  accountNames: string[]
): PickerRow[] {
  return options.flatMap(option =>
    [null, ...accountNames].map(account => ({
      backend: 'claude' as CliBackend,
      value: option.value,
      label: accountRowLabel(account, option.label),
      account,
    }))
  )
}

/**
 * Favorites from every backend, in the order they were added. Favorites of
 * backends that are not installed, or of deleted accounts, are left out.
 */
export function buildFavoriteRows(
  favoriteKeys: string[],
  sections: { backend: CliBackend; options: ModelOption[] }[],
  accountNames: string[],
  claudeOptions: ModelOption[]
): PickerRow[] {
  const showAccounts = accountNames.length > 0
  const rows: PickerRow[] = []
  for (const key of favoriteKeys) {
    const parsed = parseModelKey(key)
    if (!parsed) continue
    const { backend, model, account } = parsed
    const section = sections.find(s => s.backend === backend)
    if (!section) continue
    if (account && !accountNames.includes(account)) continue
    const isAccountRow = backend === 'claude' && showAccounts
    const options = isAccountRow ? claudeOptions : section.options
    const label = options.find(o => o.value === model)?.label ?? model
    rows.push(
      isAccountRow
        ? {
            backend,
            value: model,
            label: accountRowLabel(account, label),
            account,
          }
        : { backend, value: model, label }
    )
  }
  return rows
}
