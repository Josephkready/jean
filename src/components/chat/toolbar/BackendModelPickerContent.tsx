import { Check, RefreshCw, Star, Zap } from '@/components/icons/reicon'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { toast } from 'sonner'
import type { CliBackend, CustomCliProfile } from '@/types/preferences'
import { usePatchPreferences, usePreferences } from '@/services/preferences'
import {
  useAvailableOpencodeModels,
  useRefreshOpencodeModels,
} from '@/services/opencode-cli'
import { useAvailableCursorModels } from '@/services/cursor-cli'
import { useAvailablePiModels } from '@/services/pi-cli'
import { useAvailableCommandCodeModels } from '@/services/commandcode-cli'
import { useAvailableGrokModels } from '@/services/grok-cli'
import { useAvailableKimiModels } from '@/services/kimi-cli'
import { useAvailableDevinModels } from '@/services/devin-cli'
import { useAvailableAntigravityModels } from '@/services/antigravity-cli'
import { useAvailableMuseModels } from '@/services/muse-cli'
import {
  getCatalogModelFastInfo,
  useModelCatalog,
  useRefreshModelCatalog,
} from '@/services/model-catalog'
import { cn } from '@/lib/utils'
import {
  getBackendIcon,
  getBackendPlainLabel,
  isBetaBackend,
} from '@/components/ui/backend-label'
import {
  formatCursorModelLabel,
  formatOpencodeModelLabel,
  formatPiModelLabel,
  getProviderDisplayName,
} from '@/components/chat/toolbar/toolbar-utils'
import { useToolbarDerivedState } from '@/components/chat/toolbar/useToolbarDerivedState'
import {
  buildClaudeAccountRows,
  buildFavoriteRows,
  getClaudeAccountNames,
  getClaudeCatalogOptions,
  modelKey,
  type PickerRow,
} from '@/components/chat/toolbar/model-picker-rows'
import { useIsMobile } from '@/hooks/use-mobile'
import { getModifierSymbol } from '@/lib/platform'

const FAVORITES_TAB = 'favorites'
type PickerTab = CliBackend | typeof FAVORITES_TAB

/** Whether an account row (`null` = default login) matches the session provider. */
function isSameAccount(account: string | null, provider: string | null) {
  if (account === null) return !provider || provider === '__anthropic__'
  return account === provider
}

interface BackendModelPickerContentProps {
  open: boolean
  selectedBackend: CliBackend
  selectedModel: string
  selectedProvider: string | null
  installedBackends: CliBackend[]
  customCliProfiles: CustomCliProfile[]
  sessionHasMessages?: boolean
  providerLocked?: boolean
  onProviderChange?: (provider: string) => void
  onModelChange: (model: string) => void
  onBackendModelChange: (backend: CliBackend, model: string) => void
  /**
   * Set the Claude account (`null` = default login) and model together. When
   * given, account profiles (own CLAUDE_CONFIG_DIR) get their own rows.
   */
  onClaudeAccountSelect?: (account: string | null, model: string) => void
  onRequestClose: () => void
  /** Called after a model is applied and the picker has been asked to close. */
  onAfterSelect?: (backend: CliBackend, model: string) => void
  defaultModelOption?: { value: string; label: string }
  searchPlaceholder?: string
  className?: string
  commandListClassName?: string
}

export function BackendModelPickerContent({
  open,
  selectedBackend,
  selectedModel,
  selectedProvider,
  installedBackends,
  customCliProfiles,
  sessionHasMessages: _sessionHasMessages,
  providerLocked: _providerLocked,
  onProviderChange,
  onModelChange,
  onBackendModelChange,
  onClaudeAccountSelect,
  onRequestClose,
  onAfterSelect,
  defaultModelOption,
  searchPlaceholder,
  className,
  commandListClassName,
}: BackendModelPickerContentProps) {
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<PickerTab>(selectedBackend)
  const [highlightedValue, setHighlightedValue] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isMobile = useIsMobile()
  const fastModifier = getModifierSymbol()
  const fastShortcutLabel =
    fastModifier === 'Ctrl' ? 'Ctrl F' : `${fastModifier}F`

  const { data: prefs } = usePreferences()
  const { data: modelCatalog } = useModelCatalog()
  const refreshModelCatalog = useRefreshModelCatalog()
  const refreshOpencodeModels = useRefreshOpencodeModels()
  const patchPreferences = usePatchPreferences()
  const favoriteModels = useMemo(
    () => prefs?.favorite_models ?? [],
    [prefs?.favorite_models]
  )
  const favoriteSet = useMemo(() => new Set(favoriteModels), [favoriteModels])
  const favKey = useCallback(
    (backend: CliBackend, model: string, account?: string | null) =>
      modelKey(backend, model, account),
    []
  )
  const handleToggleFavorite = useCallback(
    (row: PickerRow) => {
      const key = modelKey(row.backend, row.value, row.account)
      const next = favoriteSet.has(key)
        ? favoriteModels.filter(k => k !== key)
        : [...favoriteModels, key]
      patchPreferences.mutate({ favorite_models: next })
    },
    [favoriteSet, favoriteModels, patchPreferences]
  )

  const fastModels = useMemo(
    () => prefs?.fast_mode_models ?? [],
    [prefs?.fast_mode_models]
  )
  const fastSet = useMemo(() => new Set(fastModels), [fastModels])
  const isFastRemembered = useCallback(
    (backend: CliBackend, baseModel: string, account?: string | null) =>
      fastSet.has(favKey(backend, baseModel, account)),
    [fastSet, favKey]
  )
  const setFastRemembered = useCallback(
    (
      backend: CliBackend,
      baseModel: string,
      on: boolean,
      account?: string | null
    ) => {
      const key = favKey(backend, baseModel, account)
      if (on === fastSet.has(key)) return
      const next = on ? [...fastModels, key] : fastModels.filter(k => k !== key)
      patchPreferences.mutate({ fast_mode_models: next })
    },
    [favKey, fastSet, fastModels, patchPreferences]
  )

  const { data: availableOpencodeModels, isError: opencodeModelsError } =
    useAvailableOpencodeModels({
      enabled: installedBackends.includes('opencode'),
    })
  const { data: availableCursorModels } = useAvailableCursorModels({
    enabled: installedBackends.includes('cursor'),
  })
  const { data: availablePiModels } = useAvailablePiModels({
    enabled: installedBackends.includes('pi'),
  })
  const { data: availableCommandCodeModels } = useAvailableCommandCodeModels({
    enabled: installedBackends.includes('commandcode'),
  })
  const { data: availableGrokModels } = useAvailableGrokModels({
    enabled: installedBackends.includes('grok'),
  })
  const { data: availableKimiModels } = useAvailableKimiModels({
    enabled: installedBackends.includes('kimi'),
  })
  const { data: availableDevinModels } = useAvailableDevinModels({
    enabled: installedBackends.includes('devin'),
  })
  const { data: availableAntigravityModels } = useAvailableAntigravityModels({
    enabled: installedBackends.includes('antigravity'),
  })
  const { data: availableMuseModels } = useAvailableMuseModels({
    enabled: installedBackends.includes('muse'),
  })

  const opencodeModelOptions = useMemo(() => {
    if (opencodeModelsError) return []
    return availableOpencodeModels?.map(model => ({
      value: model,
      label: formatOpencodeModelLabel(model),
    }))
  }, [availableOpencodeModels, opencodeModelsError])
  const cursorModelOptions = useMemo(
    () =>
      availableCursorModels?.length
        ? availableCursorModels.map(model => ({
            value: `cursor/${model.id}`,
            label: model.label || formatCursorModelLabel(model.id),
          }))
        : undefined,
    [availableCursorModels]
  )
  const piModelOptions = useMemo(
    () =>
      availablePiModels?.map(model => ({
        value: `pi/${model.id}`,
        label: model.label || formatPiModelLabel(model.id),
        is_default: model.is_default,
      })),
    [availablePiModels]
  )
  const commandcodeModelOptions = useMemo(
    () =>
      availableCommandCodeModels?.map(model => ({
        value: `commandcode/${model.id}`,
        label: model.label,
      })),
    [availableCommandCodeModels]
  )
  const grokModelOptions = useMemo(
    () =>
      availableGrokModels?.map(model => ({
        value: `grok/${model.id}`,
        label: model.label,
      })),
    [availableGrokModels]
  )
  const kimiModelOptions = useMemo(
    () =>
      availableKimiModels?.map(model => ({
        value: `kimi/${model.id}`,
        label: model.label,
      })),
    [availableKimiModels]
  )
  const devinModelOptions = useMemo(
    () =>
      availableDevinModels?.map(model => ({
        value: `devin/${model.id}`,
        label: model.label,
      })),
    [availableDevinModels]
  )
  const antigravityModelOptions = useMemo(
    () =>
      availableAntigravityModels?.map(model => ({
        value: `antigravity/${model.id}`,
        label: model.label,
      })),
    [availableAntigravityModels]
  )
  const museModelOptions = useMemo(
    () =>
      availableMuseModels?.map(model => ({
        value: model.id,
        label: model.label,
      })),
    [availableMuseModels]
  )

  const { backendModelSections: baseBackendModelSections } =
    useToolbarDerivedState({
      selectedBackend,
      selectedProvider,
      selectedModel,
      opencodeModelOptions,
      cursorModelOptions,
      piModelOptions,
      commandcodeModelOptions,
      grokModelOptions,
      kimiModelOptions,
      museModelOptions,
      devinModelOptions,
      customCliProfiles,
      installedBackends,
    })

  const backendModelSections = useMemo(() => {
    let sections = baseBackendModelSections
    // useToolbarDerivedState only knows the static Antigravity fallback list;
    // surface CLI-reported models first and keep static entries as fallbacks.
    if (antigravityModelOptions?.length) {
      const dynamicValues = new Set(
        antigravityModelOptions.map(option => option.value)
      )
      sections = sections.map(section =>
        section.backend === 'antigravity'
          ? {
              ...section,
              options: [
                ...antigravityModelOptions,
                ...section.options.filter(
                  option => !dynamicValues.has(option.value)
                ),
              ],
            }
          : section
      )
    }
    if (defaultModelOption) {
      sections = sections.map(section => ({
        ...section,
        options: [defaultModelOption, ...section.options],
      }))
    }
    return sections
  }, [antigravityModelOptions, baseBackendModelSections, defaultModelOption])

  const installedBackendsSet = useMemo(
    () => new Set(installedBackends),
    [installedBackends]
  )

  const sidebarBackends = useMemo(
    () =>
      backendModelSections.flatMap(section =>
        installedBackendsSet.has(section.backend) ? [section.backend] : []
      ),
    [backendModelSections, installedBackendsSet]
  )

  const accountNames = useMemo(
    () =>
      onClaudeAccountSelect && installedBackendsSet.has('claude')
        ? getClaudeAccountNames(customCliProfiles)
        : [],
    [customCliProfiles, installedBackendsSet, onClaudeAccountSelect]
  )
  const claudeCatalogOptions = useMemo(
    () => getClaudeCatalogOptions(modelCatalog),
    [modelCatalog]
  )

  const favoriteRows = useMemo(
    () =>
      buildFavoriteRows(
        favoriteModels,
        backendModelSections.filter(section =>
          installedBackendsSet.has(section.backend)
        ),
        accountNames,
        claudeCatalogOptions
      ),
    [
      accountNames,
      backendModelSections,
      claudeCatalogOptions,
      favoriteModels,
      installedBackendsSet,
    ]
  )
  const showFavoritesTab = favoriteRows.length > 0

  const showSidebar = sidebarBackends.length > 1 || showFavoritesTab

  // Clear search only when the picker opens — not on every sidebarBackends
  // identity change (that array is rebuilt often and wiping search mid-type
  // left Cmd+F acting on the unfiltered first catalog row).
  useEffect(() => {
    if (!open) return
    setSearch('')
  }, [open])

  const fallbackBackend = sidebarBackends.includes(selectedBackend)
    ? selectedBackend
    : (sidebarBackends[0] ?? selectedBackend)

  // Open on Favorites when there are any, else on the session's backend.
  const pickOpenTab = useEffectEvent(() => {
    setActiveTab(showFavoritesTab ? FAVORITES_TAB : fallbackBackend)
  })
  useEffect(() => {
    if (open) pickOpenTab()
  }, [open])

  // Never leave the active tab on an uninstalled backend (empty model list)
  // or on Favorites after the last favorite is removed.
  useEffect(() => {
    if (!open) return
    setActiveTab(prev => {
      if (prev === FAVORITES_TAB) {
        return showFavoritesTab ? prev : fallbackBackend
      }
      return sidebarBackends.includes(prev) ? prev : fallbackBackend
    })
  }, [open, showFavoritesTab, sidebarBackends, fallbackBackend])

  const activeSection = useMemo(
    () =>
      activeTab === FAVORITES_TAB
        ? undefined
        : backendModelSections.find(section => section.backend === activeTab),
    [backendModelSections, activeTab]
  )

  const filteredOptions = useMemo((): PickerRow[] => {
    let rows: PickerRow[]
    if (activeTab === FAVORITES_TAB) {
      rows = favoriteRows
    } else if (activeTab === 'claude' && accountNames.length > 0) {
      rows = buildClaudeAccountRows(claudeCatalogOptions, accountNames)
    } else if (activeSection) {
      rows = activeSection.options.map(option => ({
        ...option,
        backend: activeTab,
      }))
    } else {
      return []
    }
    const query = search.trim().toLowerCase()
    const filtered = !query
      ? rows
      : rows.filter(row =>
          `${row.label} ${row.value}`.toLowerCase().includes(query)
        )
    if (activeTab === FAVORITES_TAB) return filtered
    const favs: PickerRow[] = []
    const rest: PickerRow[] = []
    for (const row of filtered) {
      if (favoriteSet.has(modelKey(row.backend, row.value, row.account))) {
        favs.push(row)
      } else rest.push(row)
    }
    const result = [...favs, ...rest]
    if (activeTab === 'commandcode') {
      const rawQuery = search.trim()
      if (rawQuery) {
        const suffix = rawQuery.startsWith('commandcode/')
          ? rawQuery.slice('commandcode/'.length).trim()
          : rawQuery
        if (!suffix) return result
        const customValue = `commandcode/${suffix}`
        const customExists = result.some(option => option.value === customValue)
        if (!customExists) {
          result.unshift({
            backend: 'commandcode',
            value: customValue,
            label: `Use Command Code model "${rawQuery}"`,
          })
        }
      }
    }
    return result
  }, [
    accountNames,
    activeSection,
    activeTab,
    claudeCatalogOptions,
    favoriteRows,
    favoriteSet,
    search,
  ])

  const getRowCommandValue = useCallback(
    (row: PickerRow) => modelKey(row.backend, row.value, row.account),
    []
  )

  // Derive a valid highlight from the current option list (avoids effect chain
  // when activeBackend / filteredOptions change after open or search).
  const resolvedHighlightedValue = useMemo(() => {
    if (!open) return highlightedValue
    const currentStillVisible = filteredOptions.some(
      row => getRowCommandValue(row) === highlightedValue
    )
    if (currentStillVisible) return highlightedValue
    const firstOption = filteredOptions[0]
    return firstOption ? getRowCommandValue(firstOption) : ''
  }, [filteredOptions, getRowCommandValue, highlightedValue, open])

  const highlightedOption = useMemo(() => {
    const match = filteredOptions.find(
      row => getRowCommandValue(row) === resolvedHighlightedValue
    )
    if (match) return match
    // Only fall back to the first visible option when we have a resolved
    // highlight target. An empty resolved value means "nothing selected"
    // (e.g. search with zero matches) — do not invent a fast-mode target.
    if (!resolvedHighlightedValue) return undefined
    return filteredOptions[0]
  }, [filteredOptions, getRowCommandValue, resolvedHighlightedValue])

  // Backend the toolbar actions (refresh, placeholder, Cmd+F) apply to. On the
  // Favorites tab it follows the highlighted row.
  const activeBackend: CliBackend =
    activeTab === FAVORITES_TAB
      ? (highlightedOption?.backend ?? selectedBackend)
      : activeTab

  useEffect(() => {
    if (!open) return
    const rafId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [open])

  // Apply a row's model (or its fast/base variant) to the session.
  const applyModel = useCallback(
    (row: PickerRow, model: string) => {
      if (row.account !== undefined && onClaudeAccountSelect) {
        onClaudeAccountSelect(row.account, model)
      } else if (row.backend === selectedBackend) {
        onModelChange(model)
      } else {
        onBackendModelChange(row.backend, model)
      }
    },
    [
      onBackendModelChange,
      onClaudeAccountSelect,
      onModelChange,
      selectedBackend,
    ]
  )

  const handleSelect = useCallback(
    (row: PickerRow) => {
      const { backend, value: model } = row
      // Resolve to fast variant if user previously enabled fast for this base model.
      const info = getCatalogModelFastInfo(modelCatalog, backend, model)
      const resolved =
        info.supportsFast &&
        !info.isFast &&
        info.fastModel &&
        isFastRemembered(backend, info.baseModel, row.account)
          ? info.fastModel
          : model
      applyModel(row, resolved)
      onRequestClose()
      onAfterSelect?.(backend, resolved)
    },
    [applyModel, isFastRemembered, modelCatalog, onAfterSelect, onRequestClose]
  )

  const handleTabClick = useCallback((tab: PickerTab) => {
    setActiveTab(tab)
    setSearch('')
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
  }, [])

  const handleRefreshModels = useCallback(async () => {
    const toastId = toast.loading('Refreshing model list...')

    try {
      if (activeBackend === 'opencode') {
        await refreshOpencodeModels.mutateAsync()
      } else {
        await refreshModelCatalog.mutateAsync()
      }
      toast.success('Model list refreshed', { id: toastId })
    } catch (error) {
      toast.error(`Failed to refresh model list: ${error}`, { id: toastId })
    }
  }, [activeBackend, refreshModelCatalog, refreshOpencodeModels])

  const handleUseHighlightedFastMode = useCallback(() => {
    if (!highlightedOption) return false

    const { backend } = highlightedOption
    const fastInfo = getCatalogModelFastInfo(
      modelCatalog,
      backend,
      highlightedOption.value
    )
    if (!fastInfo.supportsFast || !fastInfo.fastModel) return false

    setFastRemembered(
      backend,
      fastInfo.baseModel,
      true,
      highlightedOption.account
    )
    applyModel(highlightedOption, fastInfo.fastModel)
    onRequestClose()
    onAfterSelect?.(backend, fastInfo.fastModel)
    return true
  }, [
    applyModel,
    highlightedOption,
    modelCatalog,
    onAfterSelect,
    onRequestClose,
    setFastRemembered,
  ])

  const onUseHighlightedFastMode = useEffectEvent(() => {
    handleUseHighlightedFastMode()
  })

  const onBackendDigitShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.altKey || event.shiftKey) return
    const match = event.code.match(/^Digit([1-9])$/)
    if (!match) return
    const idx = Number(match[1]) - 1
    const backend = sidebarBackends[idx]
    if (!backend) return
    event.preventDefault()
    event.stopPropagation()
    handleTabClick(backend)
  })

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'f') return

      event.preventDefault()
      event.stopPropagation()
      onUseHighlightedFastMode()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open])

  useEffect(() => {
    if (!open || sidebarBackends.length <= 1) return
    const handler = (event: KeyboardEvent) => onBackendDigitShortcut(event)
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, sidebarBackends.length])

  // Always surface the active Claude custom provider in the model picker so
  // mid-session switches stay discoverable (provider is changed via the
  // dedicated Provider control, not locked after the first message).
  const showProviderHint =
    activeTab === 'claude' && customCliProfiles.length > 0

  const activeTabLabel =
    activeTab === FAVORITES_TAB ? 'favorite' : getBackendPlainLabel(activeTab)
  const placeholder = searchPlaceholder ?? `Search ${activeTabLabel} models...`

  // Claude/Codex use the CDN model catalog; OpenCode refreshes via CLI.
  const canRefreshModels =
    activeTab === 'claude' || activeTab === 'codex' || activeTab === 'opencode'
  const isRefreshingModels =
    activeBackend === 'opencode'
      ? refreshOpencodeModels.isPending
      : refreshModelCatalog.isPending

  const sidebar = showSidebar ? (
    <SidebarBackends
      orientation={isMobile ? 'horizontal' : 'vertical'}
      backends={sidebarBackends}
      showFavorites={showFavoritesTab}
      activeTab={activeTab}
      onSelect={handleTabClick}
    />
  ) : null

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {isMobile && sidebar}
      <div className="flex min-h-0 flex-1">
        {!isMobile && sidebar}
        <Command
          shouldFilter={false}
          value={resolvedHighlightedValue}
          onValueChange={setHighlightedValue}
          className="flex h-full min-w-0 flex-1 flex-col"
        >
          <div className="flex gap-2 border-b p-2">
            <Input
              ref={searchInputRef}
              value={search}
              spellCheck={false}
              onChange={event => {
                const next = event.target.value
                setSearch(next)
                // Drop the previous highlight so the next render re-resolves to
                // the first option that matches the new query (or nothing).
                // Without this, a prior highlight can survive a filter change
                // and Cmd+F would act on a model no longer on screen.
                setHighlightedValue('')
              }}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  onRequestClose()
                }
              }}
              placeholder={placeholder}
              className="h-9 text-base md:text-sm"
            />
            {canRefreshModels && (
              <button
                type="button"
                aria-label="Refresh model list"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                disabled={isRefreshingModels}
                onClick={event => {
                  event.preventDefault()
                  event.stopPropagation()
                  void handleRefreshModels()
                }}
              >
                <RefreshCw
                  className={cn(
                    'h-4 w-4',
                    isRefreshingModels && 'animate-spin'
                  )}
                />
              </button>
            )}
          </div>

          {onProviderChange && activeTab === 'claude' ? (
            <div className="px-4 py-2">
              <Select
                value={selectedProvider ?? '__anthropic__'}
                onValueChange={onProviderChange}
              >
                <SelectTrigger
                  className="h-8 text-xs"
                  aria-label="Investigation provider"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__anthropic__">Anthropic</SelectItem>
                  {customCliProfiles.map(profile => (
                    <SelectItem key={profile.name} value={profile.name}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            showProviderHint && (
              <div className="px-4 pt-2 text-xs text-muted-foreground">
                Provider: {getProviderDisplayName(selectedProvider)}
              </div>
            )
          )}

          <CommandList
            className={cn(
              'max-h-[24rem]',
              showProviderHint && 'pt-1',
              commandListClassName
            )}
          >
            {filteredOptions.length === 0 && (
              <CommandEmpty>No {activeTabLabel} models found.</CommandEmpty>
            )}

            {filteredOptions.map(option => {
              const rowBackend = option.backend
              const rowKey = getRowCommandValue(option)
              const fastInfo = getCatalogModelFastInfo(
                modelCatalog,
                rowBackend,
                option.value
              )
              const supportsFast = Boolean(
                fastInfo.supportsFast && fastInfo.fastModel
              )
              const isSameRowAccount =
                option.account === undefined ||
                isSameAccount(option.account, selectedProvider)
              const isSelectedBase =
                selectedBackend === rowBackend &&
                isSameRowAccount &&
                selectedModel === option.value
              const isSelectedFast =
                supportsFast &&
                selectedBackend === rowBackend &&
                isSameRowAccount &&
                selectedModel === fastInfo.fastModel
              const isRowSelected = isSelectedBase || isSelectedFast
              const isFavorite = favoriteSet.has(rowKey)
              const RowBackendIcon =
                activeTab === FAVORITES_TAB ? getBackendIcon(rowBackend) : null

              return (
                <CommandItem
                  key={rowKey}
                  value={rowKey}
                  onSelect={() => handleSelect(option)}
                >
                  {RowBackendIcon && (
                    <RowBackendIcon
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-label={getBackendPlainLabel(rowBackend)}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{option.label}</div>
                    {option.value !== defaultModelOption?.value && (
                      <div className="truncate text-xs text-muted-foreground">
                        {option.value}
                      </div>
                    )}
                  </div>
                  <div
                    className="ml-2 grid shrink-0 grid-cols-[5.75rem_1.5rem_1rem] items-center gap-2"
                    data-testid={`model-actions-${rowKey}`}
                  >
                    <div className="flex w-[5.75rem] justify-end">
                      {supportsFast && fastInfo.fastModel && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={isSelectedFast}
                              aria-label={
                                isSelectedFast
                                  ? `Disable fast mode for ${option.label}`
                                  : `Enable fast mode for ${option.label}`
                              }
                              onMouseDown={event => event.preventDefault()}
                              onPointerDown={event => event.stopPropagation()}
                              onClick={event => {
                                event.preventDefault()
                                event.stopPropagation()
                                const next = isSelectedFast
                                  ? fastInfo.baseModel
                                  : fastInfo.fastModel
                                if (!next) return
                                setFastRemembered(
                                  rowBackend,
                                  fastInfo.baseModel,
                                  !isSelectedFast,
                                  option.account
                                )
                                applyModel(option, next)
                              }}
                              className={cn(
                                'flex h-6 shrink-0 items-center gap-1 rounded-md border border-border/60 px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                'hover:bg-muted/80 hover:text-foreground'
                              )}
                            >
                              <Zap
                                className={cn(
                                  'h-3 w-3',
                                  isSelectedFast && 'fill-warning text-warning'
                                )}
                              />
                              <span>Fast</span>
                              <Kbd className="ml-0.5 h-4 min-w-0 bg-background/70 px-1 text-[9px] normal-case tracking-normal">
                                {fastShortcutLabel}
                              </Kbd>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {isSelectedFast
                              ? 'Fast tier on — click to disable'
                              : `Enable fast tier (priority queue) · ${fastShortcutLabel}`}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isFavorite}
                          aria-label={
                            isFavorite
                              ? `Unfavorite ${option.label}`
                              : `Favorite ${option.label}`
                          }
                          onMouseDown={event => event.preventDefault()}
                          onPointerDown={event => event.stopPropagation()}
                          onClick={event => {
                            event.preventDefault()
                            event.stopPropagation()
                            handleToggleFavorite(option)
                          }}
                          className={cn(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            'hover:bg-muted/80 hover:text-foreground'
                          )}
                        >
                          <Star
                            className={cn(
                              'h-3.5 w-3.5',
                              isFavorite && 'fill-warning text-warning'
                            )}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isFavorite
                          ? 'Remove from favourites'
                          : 'Add to favourites'}
                      </TooltipContent>
                    </Tooltip>
                    <Check
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isRowSelected ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </div>
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </div>
    </div>
  )
}

function SidebarBackends({
  orientation,
  backends,
  showFavorites,
  activeTab,
  onSelect,
}: {
  orientation: 'vertical' | 'horizontal'
  backends: CliBackend[]
  showFavorites: boolean
  activeTab: PickerTab
  onSelect: (tab: PickerTab) => void
}) {
  const isVertical = orientation === 'vertical'
  const modKey = getModifierSymbol()
  const showHints = isVertical && backends.length > 1
  const isFavoritesActive = activeTab === FAVORITES_TAB

  return (
    <div
      className={cn(
        'flex shrink-0 gap-1 bg-muted/30',
        isVertical ? 'w-12 flex-col border-r p-1.5' : 'flex-row border-b p-1.5'
      )}
      role="tablist"
      aria-orientation={orientation}
    >
      {showFavorites && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="tab"
              aria-selected={isFavoritesActive}
              aria-label="Favorites"
              onClick={() => onSelect(FAVORITES_TAB)}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors',
                'hover:bg-background hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isFavoritesActive &&
                  'bg-background text-foreground shadow-sm ring-1 ring-border'
              )}
            >
              <Star
                className={cn(
                  'h-4 w-4',
                  isFavoritesActive && 'fill-warning text-warning'
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side={isVertical ? 'right' : 'bottom'}>
            Favorites
          </TooltipContent>
        </Tooltip>
      )}
      {backends.map((backend, index) => {
        const Icon = getBackendIcon(backend)
        const isActive = backend === activeTab
        const label = getBackendPlainLabel(backend)
        const showHint = showHints && index < 9

        return (
          <Tooltip key={backend}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={label}
                onClick={() => onSelect(backend)}
                className={cn(
                  'group relative flex w-9 shrink-0 flex-col items-center justify-center rounded-md text-muted-foreground transition-colors',
                  showHint ? 'h-auto gap-0.5 py-1' : 'h-9',
                  'hover:bg-background hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive &&
                    'bg-background text-foreground shadow-sm ring-1 ring-border'
                )}
              >
                <Icon className="h-4 w-4" />
                {showHint && (
                  <span
                    aria-hidden
                    className={cn(
                      'text-[9px] leading-none tabular-nums',
                      isActive
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground/60'
                    )}
                  >
                    {modKey}
                    {index + 1}
                  </span>
                )}
                {isBetaBackend(backend) && (
                  <span
                    aria-hidden
                    className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-warning"
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side={isVertical ? 'right' : 'bottom'}>
              {label}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
