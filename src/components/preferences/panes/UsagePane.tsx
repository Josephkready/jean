import React, { useCallback } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw } from '@/components/icons/reicon'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ClaudeIcon } from '@/components/icons/ClaudeIcon'
import { CodexIcon } from '@/components/icons/CodexIcon'
import { GrokIcon } from '@/components/icons/GrokIcon'
import {
  claudeCliQueryKeys,
  useClaudeCliAuth,
  useClaudeDefaultAccountLabel,
  useClaudeCliStatus,
  useClaudeUsage,
} from '@/services/claude-cli'
import { usePreferences } from '@/services/preferences'
import { getClaudeAccountNames } from '@/components/chat/toolbar/model-picker-rows'
import {
  useCodexCliAuth,
  useCodexCliStatus,
  useCodexUsage,
} from '@/services/codex-cli'
import {
  useGrokCliAuth,
  useGrokCliStatus,
  useGrokUsage,
} from '@/services/grok-cli'
import { useNow } from '@/hooks/useNow'
import {
  formatCompactDuration,
  formatPlanName,
  toEpochMs,
} from '@/lib/usage-format'
import { HOUR_SECONDS, WEEK_SECONDS } from '@/lib/usage-pace'
import {
  UsageChartLegend,
  UsageWindows,
  type UsageWindowSpec,
} from '@/components/usage/usage-windows'
import { cn } from '@/lib/utils'

/** One card per backend: icon, name, plan badge, then usage windows. */
function UsageCard({
  title,
  subtitle,
  Icon,
  plan,
  anchorId,
  children,
}: {
  title: string
  /** Muted text after the title, e.g. the account's login email. */
  subtitle?: string | null
  Icon: React.ComponentType<{ className?: string }>
  plan?: string | null
  anchorId: string
  children: React.ReactNode
}) {
  return (
    <section id={anchorId} className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1 sm:px-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          <Icon className="size-4 shrink-0" />
          <span className="shrink-0">{title}</span>
          {subtitle ? (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </h3>
        {plan ? (
          <span className="truncate rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {plan} plan
          </span>
        ) : null}
      </div>
      <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4 sm:p-5">
        {children}
      </div>
    </section>
  )
}

/** `5-hour session` from the window length, `Session` when unknown. */
function sessionLabel(limitWindowSeconds?: number | null): string {
  if (!limitWindowSeconds) return 'Session'
  return `${Math.round(limitWindowSeconds / 3600)}-hour session`
}

function getQueryErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return fallback
}

function InlineStatus({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode
  tone?: 'muted' | 'error'
}) {
  return (
    <p
      className={cn(
        'text-xs leading-snug',
        tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
      )}
    >
      {children}
    </p>
  )
}

function MetaLine({ items }: { items: (string | null | undefined)[] }) {
  const parts = items.filter((p): p is string => !!p && p.length > 0)
  if (parts.length === 0) return null
  return (
    <p className="truncate text-xs text-muted-foreground">
      {parts.map((part, i) => (
        <React.Fragment key={part}>
          {i > 0 ? (
            <span className="mx-1.5 text-border" aria-hidden>
              ·
            </span>
          ) : null}
          <span>{part}</span>
        </React.Fragment>
      ))}
    </p>
  )
}

function LoadingLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin" />
      {label}
    </div>
  )
}

function ErrorLine({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <InlineStatus tone="error">{message}</InlineStatus>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 px-2 text-xs"
        onClick={onRetry}
      >
        <RefreshCw className="size-3" />
        Retry
      </Button>
    </div>
  )
}

/** Body of a Claude usage card: extra usage, then session/weekly windows. */
function ClaudeUsageBody({
  usage,
  pendingAuth,
  nowMs,
}: {
  usage: ReturnType<typeof useClaudeUsage>
  pendingAuth: boolean
  nowMs: number
}) {
  if (pendingAuth) {
    return <LoadingLine label="Checking authentication…" />
  }
  if (usage.isLoading) {
    return <LoadingLine label="Loading usage…" />
  }
  // Keep showing last-good data when only a background refetch failed.
  if (usage.isError && !usage.data) {
    return (
      <ErrorLine
        message={getQueryErrorMessage(
          usage.error,
          'Failed to load Claude usage.'
        )}
        onRetry={() => usage.refetch()}
      />
    )
  }
  if (!usage.data) {
    return <InlineStatus>No usage data available.</InlineStatus>
  }

  const data = usage.data
  const extra =
    data.extraUsageSpent != null || data.extraUsageLimit != null
      ? `Extra usage: ${data.extraUsageSpent ?? 0}${
          data.extraUsageLimit != null ? ` / ${data.extraUsageLimit}` : ''
        }`
      : null

  return (
    <div className="space-y-2">
      <MetaLine items={[extra]} />
      <UsageWindows
        nowMs={nowMs}
        primary={[
          {
            key: 'session',
            label: '5-hour session',
            usage: data.session,
            windowSeconds: 5 * HOUR_SECONDS,
          },
          {
            key: 'weekly',
            label: 'Weekly',
            usage: data.weekly,
            windowSeconds: WEEK_SECONDS,
          },
        ]}
        secondary={[
          {
            key: 'sonnet-weekly',
            label: 'Weekly · Sonnet',
            usage: data.sonnetWeekly,
            windowSeconds: WEEK_SECONDS,
          },
        ]}
      />
    </div>
  )
}

/** Usage of one Claude account profile (its own `CLAUDE_CONFIG_DIR` login). */
function ClaudeAccountUsageCard({
  account,
  enabled,
  nowMs,
}: {
  account: string
  enabled: boolean
  nowMs: number
}) {
  const usage = useClaudeUsage({ account, enabled })
  return (
    <UsageCard
      title={`Claude · ${account}`}
      subtitle={usage.data?.email}
      Icon={ClaudeIcon}
      plan={formatPlanName(usage.data?.planType, usage.data?.planTier)}
      anchorId={`pref-usage-section-claude-account-${account}`}
    >
      <ClaudeUsageBody usage={usage} pendingAuth={false} nowMs={nowMs} />
    </UsageCard>
  )
}

export const UsagePane: React.FC = () => {
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()
  const claudeAccounts = getClaudeAccountNames(
    preferences?.custom_cli_profiles ?? []
  )
  const { label: defaultAccountLabel } = useClaudeDefaultAccountLabel()
  const claudeStatus = useClaudeCliStatus()
  const claudeAuth = useClaudeCliAuth({
    enabled: !!claudeStatus.data?.installed,
  })
  const claudeUsage = useClaudeUsage({
    enabled: !!claudeStatus.data?.installed && !!claudeAuth.data?.authenticated,
  })

  const codexStatus = useCodexCliStatus()
  const codexAuth = useCodexCliAuth({ enabled: !!codexStatus.data?.installed })
  const codexUsage = useCodexUsage({
    enabled: !!codexStatus.data?.installed && !!codexAuth.data?.authenticated,
  })

  const grokStatus = useGrokCliStatus()
  const grokAuth = useGrokCliAuth({ enabled: !!grokStatus.data?.installed })
  const grokUsage = useGrokUsage({
    enabled: !!grokStatus.data?.installed && !!grokAuth.data?.authenticated,
  })

  const codexErrorMessage = getQueryErrorMessage(
    codexUsage.error,
    'Failed to load Codex usage.'
  )
  const grokErrorMessage = getQueryErrorMessage(
    grokUsage.error,
    'Failed to load Grok usage.'
  )
  // Covers the default Claude login and every account profile.
  const claudeUsageFetching =
    useIsFetching({ queryKey: claudeCliQueryKeys.usage() }) > 0
  const isRefreshing =
    claudeUsageFetching ||
    claudeAuth.isFetching ||
    codexUsage.isFetching ||
    codexAuth.isFetching ||
    grokUsage.isFetching ||
    grokAuth.isFetching

  const handleRefresh = useCallback(() => {
    void Promise.all([
      claudeStatus.refetch(),
      claudeAuth.refetch(),
      // Default login and account profiles share the usage() key prefix.
      queryClient.refetchQueries({ queryKey: claudeCliQueryKeys.usage() }),
      codexStatus.refetch(),
      codexAuth.refetch(),
      codexUsage.refetch(),
      grokStatus.refetch(),
      grokAuth.refetch(),
      grokUsage.refetch(),
    ])
  }, [
    claudeAuth,
    claudeStatus,
    codexAuth,
    codexStatus,
    codexUsage,
    grokAuth,
    grokStatus,
    grokUsage,
    queryClient,
  ])

  const latestFetchedAt = Math.max(
    claudeUsage.data?.fetchedAt ?? 0,
    codexUsage.data?.fetchedAt ?? 0,
    grokUsage.data?.fetchedAt ?? 0
  )

  // Only surface backends that are installed and logged in.
  const claudeReady =
    !!claudeStatus.data?.installed && !!claudeAuth.data?.authenticated
  const codexReady =
    !!codexStatus.data?.installed && !!codexAuth.data?.authenticated
  const grokReady =
    !!grokStatus.data?.installed && !!grokAuth.data?.authenticated

  const claudePendingAuth =
    !!claudeStatus.data?.installed && claudeAuth.isLoading
  const codexPendingAuth = !!codexStatus.data?.installed && codexAuth.isLoading
  const grokPendingAuth = !!grokStatus.data?.installed && grokAuth.isLoading

  const showClaude = claudeReady || claudePendingAuth
  // Account profiles have their own logins, so they only need the CLI.
  const showClaudeAccounts =
    !!claudeStatus.data?.installed && claudeAccounts.length > 0
  const showCodex = codexReady || codexPendingAuth
  const showGrok = grokReady || grokPendingAuth
  const hasAnyBackend =
    showClaude || showClaudeAccounts || showCodex || showGrok

  const statusLoading =
    claudeStatus.isLoading || codexStatus.isLoading || grokStatus.isLoading

  const nowMs = useNow(hasAnyBackend)
  const claudePlan = formatPlanName(
    claudeUsage.data?.planType,
    claudeUsage.data?.planTier
  )
  const codexPlan = formatPlanName(codexUsage.data?.planType)
  const grokPlan = formatPlanName(grokUsage.data?.planType)

  const renderCodex = () => {
    if (codexPendingAuth) {
      return <LoadingLine label="Checking authentication…" />
    }
    if (codexUsage.isLoading) {
      return <LoadingLine label="Loading usage…" />
    }
    // Keep showing last-good data when only a background refetch failed.
    if (codexUsage.isError && !codexUsage.data) {
      return (
        <ErrorLine
          message={codexErrorMessage}
          onRetry={() => codexUsage.refetch()}
        />
      )
    }
    if (!codexUsage.data) {
      return <InlineStatus>No usage data available.</InlineStatus>
    }

    const data = codexUsage.data
    const credits =
      data.creditsRemaining !== null
        ? `Credits remaining: ${data.creditsRemaining}`
        : null

    const extraLimits = data.modelLimits.flatMap((limit): UsageWindowSpec[] => [
      {
        key: `${limit.label}-session`,
        label: limit.label,
        usage: limit.session,
      },
      {
        key: `${limit.label}-weekly`,
        label: `${limit.label} · Weekly`,
        usage: limit.weekly,
      },
    ])

    return (
      <div className="space-y-2">
        <MetaLine items={[credits]} />
        {data.rateLimitReachedType ? (
          <InlineStatus tone="error">
            Rate limit reached ({data.rateLimitReachedType.replace(/_/g, ' ')})
          </InlineStatus>
        ) : null}
        <UsageWindows
          nowMs={nowMs}
          primary={[
            {
              key: 'session',
              label: sessionLabel(data.session?.limitWindowSeconds),
              usage: data.session,
            },
            { key: 'weekly', label: 'Weekly', usage: data.weekly },
          ]}
          secondary={[
            { key: 'reviews', label: 'Code reviews', usage: data.reviews },
            ...extraLimits,
          ]}
        />
      </div>
    )
  }

  const renderGrok = () => {
    if (grokPendingAuth) {
      return <LoadingLine label="Checking authentication…" />
    }
    if (grokUsage.isLoading) {
      return <LoadingLine label="Loading usage…" />
    }
    // Keep showing last-good data when only a background refetch failed.
    if (grokUsage.isError && !grokUsage.data) {
      return (
        <ErrorLine
          message={grokErrorMessage}
          onRetry={() => grokUsage.refetch()}
        />
      )
    }
    if (!grokUsage.data) {
      return <InlineStatus>No usage data available.</InlineStatus>
    }

    const data = grokUsage.data
    const codeAccess =
      data.hasGrokCodeAccess == null
        ? null
        : data.hasGrokCodeAccess
          ? 'Grok Code access: Yes'
          : 'Grok Code access: No'
    const period =
      data.periodStart || data.periodEnd
        ? `${data.periodStart ? new Date(data.periodStart).toLocaleDateString() : '—'} → ${
            data.periodEnd ? new Date(data.periodEnd).toLocaleDateString() : '—'
          }`
        : null

    // Avoid duplicating primary session as a product row when names match.
    const sessionPct = data.session?.usedPercent
    const products = data.products.filter(product => {
      const isBuild =
        /build/i.test(product.product) || product.product === 'GrokBuild'
      if (isBuild && sessionPct != null) {
        return Math.abs(product.usedPercent - sessionPct) > 0.5
      }
      return true
    })

    const tasks: string[] = []
    if (data.frequentLimit != null) {
      tasks.push(`Frequent: ${data.frequentUsed ?? 0} / ${data.frequentLimit}`)
    }
    if (data.occasionalLimit != null) {
      tasks.push(
        `Occasional: ${data.occasionalUsed ?? 0} / ${data.occasionalLimit}`
      )
    }

    return (
      <div className="space-y-2">
        <MetaLine items={[codeAccess, period]} />
        <UsageWindows
          nowMs={nowMs}
          primary={[
            { key: 'build', label: 'Grok Build', usage: data.session },
            { key: 'weekly', label: 'Weekly credits', usage: data.weekly },
          ]}
          secondary={products.map(product => ({
            key: product.product,
            label: product.product,
            usage: {
              usedPercent: product.usedPercent,
              resetsAt: data.session?.resetsAt ?? data.weekly?.resetsAt ?? null,
            },
          }))}
        />
        {tasks.length > 0 ? <MetaLine items={tasks} /> : null}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate">
          {isRefreshing ? (
            'Refreshing…'
          ) : latestFetchedAt > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="tabular-nums">
                  Updated{' '}
                  {formatCompactDuration(
                    Math.max(0, nowMs - toEpochMs(latestFetchedAt))
                  )}{' '}
                  ago
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {new Date(latestFetchedAt * 1000).toLocaleString()}
              </TooltipContent>
            </Tooltip>
          ) : (
            'Up to date'
          )}
          <span className="mx-1.5 text-border">·</span>
          Auto-refresh every 5m
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={cn('size-3', isRefreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {statusLoading && !hasAnyBackend ? (
        <LoadingLine label="Checking installed backends…" />
      ) : null}

      {!statusLoading && !hasAnyBackend ? (
        <InlineStatus>
          No AI backends with usage are installed and signed in. Install and log
          in to Claude, Codex, or Grok to see limits here.
        </InlineStatus>
      ) : null}

      {hasAnyBackend ? <UsageChartLegend /> : null}

      {showClaude ? (
        <UsageCard
          title={
            claudeAccounts.length ? `Claude · ${defaultAccountLabel}` : 'Claude'
          }
          subtitle={claudeUsage.data?.email}
          Icon={ClaudeIcon}
          plan={claudePlan}
          anchorId="pref-usage-section-claude"
        >
          <ClaudeUsageBody
            usage={claudeUsage}
            pendingAuth={claudePendingAuth}
            nowMs={nowMs}
          />
        </UsageCard>
      ) : null}

      {showClaudeAccounts
        ? claudeAccounts.map(account => (
            <ClaudeAccountUsageCard
              key={account}
              account={account}
              enabled={!!claudeStatus.data?.installed}
              nowMs={nowMs}
            />
          ))
        : null}

      {showCodex ? (
        <UsageCard
          title="Codex"
          Icon={CodexIcon}
          plan={codexPlan}
          anchorId="pref-usage-section-codex"
        >
          {renderCodex()}
        </UsageCard>
      ) : null}

      {showGrok ? (
        <UsageCard
          title="Grok"
          Icon={GrokIcon}
          plan={grokPlan}
          anchorId="pref-usage-section-grok"
        >
          {renderGrok()}
        </UsageCard>
      ) : null}
    </div>
  )
}
