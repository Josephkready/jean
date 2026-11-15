import type { ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ArrowLeft } from '@/components/icons/reicon'
import { Button } from '@/components/ui/button'
import { LinuxWindowControls } from '@/components/titlebar/LinuxWindowControls'
import { isNativeApp } from '@/lib/environment'
import {
  isClientLinux,
  isClientMacOS,
  isIPadOSStandalone,
} from '@/lib/platform'
import { cn } from '@/lib/utils'

/**
 * Full-window project-settings shell (no overlay, no focus trap).
 * App preferences use the shared modal Dialog instead.
 */
export function SettingsPage({
  open,
  onOpenChange,
  onEscapeKeyDown,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onEscapeKeyDown?: (event: KeyboardEvent) => void
  title: string
  children: ReactNode
}) {
  const native = isNativeApp()

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed inset-x-0 top-[var(--vv-offset-top,0px)] bottom-0 z-[70] overflow-hidden bg-background font-sans pt-[var(--safe-area-top)] outline-none',
            native &&
              isClientMacOS &&
              '[&_[data-settings-title]]:pl-[calc(var(--mac-titlebar-action-left-inset)+1rem)]',
            !native &&
              isIPadOSStandalone() &&
              '[&_[data-settings-title]]:pl-[76px]',
            native && isClientLinux && '[&_main>header]:pr-36'
          )}
          onInteractOutside={event => event.preventDefault()}
          onEscapeKeyDown={event => {
            event.stopPropagation()
            if (
              document.querySelector(
                '[data-slot="popover-content"], [data-slot="select-content"]'
              )
            ) {
              event.preventDefault()
              return
            }
            onEscapeKeyDown?.(event)
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {title}
          </DialogPrimitive.Title>
          {children}
          {native && isClientLinux && (
            <div className="absolute right-0 top-3">
              <LinuxWindowControls />
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function SettingsBackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className="w-full justify-start gap-2 text-muted-foreground"
    >
      <ArrowLeft className="size-4" />
      Back
    </Button>
  )
}
