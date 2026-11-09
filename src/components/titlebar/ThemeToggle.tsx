import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Moon, Sun } from '@/components/icons/reicon'
import { useTheme } from '@/hooks/use-theme'
import { usePatchPreferences } from '@/services/preferences'
import { nextTheme, resolveTheme } from './theme-toggle'

const prefersDark = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches

/** Compact light/dark toggle next to the bug button (#47). Persists via the
 * same path as Preferences > Appearance (localStorage + saved preferences). */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const patchPreferences = usePatchPreferences()
  const resolved = resolveTheme(theme, prefersDark())
  const target = nextTheme(theme, prefersDark())

  const onClick = useCallback(() => {
    const next = nextTheme(theme, prefersDark())
    setTheme(next)
    patchPreferences.mutate({ theme: next })
  }, [theme, setTheme, patchPreferences])

  const label = `Switch to ${target} mode`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={onClick}
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-none text-foreground/70 hover:text-foreground"
          aria-label={label}
          data-feature="header.theme-toggle"
          data-testid="theme-toggle"
        >
          {resolved === 'dark' ? (
            <Sun className="size-3.5" />
          ) : (
            <Moon className="size-3.5" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
