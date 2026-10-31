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
/** Provider-list label for the default Claude login when its account is unknown. */
export const ANTHROPIC_PROVIDER_LABEL = 'Anthropic'

/**
 * Short name of the default Claude login: the local part of its email
 * (`j60218@gmail.com` -> `j60218`), or `fallback` when the email is unknown.
 */
export function defaultAccountShortName(
  email: string | null | undefined,
  fallback: string = ANTHROPIC_PROVIDER_LABEL
): string {
  const local = email?.split('@')[0]?.trim()
  return local ? local : fallback
}

/** Favorite / row key: `backend:model`, or `backend@account:model` for accounts. */
export function modelKey(
  backend: CliBackend,
  model: string,
  account?: string | null
): string {
  return account
    ? `${backend}@${encodeURIComponent(account)}:${model}`
    : `${backend}:${model}`
}

export function parseModelKey(
  key: string
): { backend: CliBackend; model: string; account: string | null } | null {
  // Backend ids never contain ':' or '@'; models can contain ':' (opencode tags).
  const match = /^([a-z0-9_-]+)(?:@([^:]+))?:(.+)$/.exec(key)
  if (!match) return null
  const [, backend, account, model] = match
  if (!backend || !model) return null
  return {
    backend: backend as CliBackend,
    model,
    account: account ? decodeURIComponent(account) : null,
  }
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

/**
 * Account names are used inside favorite keys (`backend@account:model`), and
 * parseModelKey splits on ':', so an account name containing ':' cannot round-trip.
 * Such profiles are not offered as account rows.
 */
export function getClaudeAccountNames(profiles: CustomCliProfile[]): string[] {
  return profiles
    .filter(isClaudeAccountProfile)
    .map(profile => profile.name)
    .filter(name => !name.includes(':'))
}

export function getClaudeCatalogOptions(
  catalog: ModelCatalog | null | undefined
): ModelOption[] {
  return getCatalogModelOptions(catalog, 'claude').map(option => ({
    ...option,
    label: option.label.replace(/^Claude\s+/, ''),
  }))
}

export function accountRowLabel(
  account: string | null,
  label: string,
  defaultAccountLabel: string = DEFAULT_ACCOUNT_LABEL
): string {
  return `${account ?? defaultAccountLabel} · ${label}`
}

/** One row per Claude model and account, accounts side by side per model. */
export function buildClaudeAccountRows(
  options: ModelOption[],
  accountNames: string[],
  defaultAccountLabel: string = DEFAULT_ACCOUNT_LABEL
): PickerRow[] {
  return options.flatMap(option =>
    [null, ...accountNames].map(account => ({
      backend: 'claude' as CliBackend,
      value: option.value,
      label: accountRowLabel(account, option.label, defaultAccountLabel),
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
  claudeOptions: ModelOption[],
  defaultAccountLabel: string = DEFAULT_ACCOUNT_LABEL
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
            label: accountRowLabel(account, label, defaultAccountLabel),
            account,
          }
        : { backend, value: model, label }
    )
  }
  return rows
}
