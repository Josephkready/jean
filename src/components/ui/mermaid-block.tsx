import { useEffect, useId, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import type * as PeleModule from 'pele'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { copyToClipboard } from '@/lib/clipboard'
import { toast } from 'sonner'
import { Copy, Maximize2 } from '@/components/icons/reicon'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'

type Pele = typeof PeleModule

// Load Pele on the first diagram. Later blocks render synchronously, so
// remounts (session switches, reopened modals) keep their height.
let pele: Pele | undefined
let peleLoad: Promise<Pele> | undefined
function loadPele() {
  peleLoad ??= import('pele').then(
    module => (pele = module),
    error => {
      peleLoad = undefined
      throw error
    }
  )
  return peleLoad
}

interface RenderResult {
  svg?: string
  error?: string
}

function renderDiagram(
  module: Pele,
  source: string,
  idPrefix: string
): RenderResult {
  try {
    const { svg } = module.render(source, {
      idPrefix,
      // Text is measured with this font, so it must match the rendered one.
      fontFamily: getComputedStyle(document.body).fontFamily,
      links: false,
      images: false,
    })
    return {
      svg: DOMPurify.sanitize(svg, {
        FORBID_TAGS: ['script', 'iframe', 'img', 'image', 'a', 'foreignObject'],
      }),
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export function MermaidBlock({ source }: { source: string }) {
  const idPrefix = `pele-${useId().replace(/[^\w-]/g, '')}-`
  const [module, setModule] = useState(pele)
  const [loadError, setLoadError] = useState<string>()
  const [showCode, setShowCode] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (module) return
    let disposed = false
    loadPele().then(
      loaded => {
        if (!disposed) setModule(() => loaded)
      },
      () => {
        if (!disposed) setLoadError('Unable to load the diagram renderer.')
      }
    )
    return () => {
      disposed = true
    }
  }, [module])

  const current = useMemo<RenderResult | undefined>(() => {
    if (loadError) return { error: loadError }
    return module ? renderDiagram(module, source, idPrefix) : undefined
  }, [module, loadError, source, idPrefix])

  const diagram = current?.svg ? (
    <div
      role="img"
      aria-label="Mermaid diagram"
      className="min-w-0 overflow-auto p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: current.svg }}
    />
  ) : null

  return (
    <div className="my-5 min-w-0 max-w-full overflow-hidden rounded-lg border bg-muted/30">
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
        <span className="mr-auto px-2 text-xs text-muted-foreground">
          Mermaid
        </span>
        <ToggleGroup
          type="single"
          value={showCode ? 'code' : 'diagram'}
          onValueChange={value => {
            if (value) setShowCode(value === 'code')
          }}
          aria-label="Diagram view"
          size="sm"
          className="gap-0.5 rounded-md bg-muted p-0.5"
        >
          <ToggleGroupItem
            value="diagram"
            className="rounded-sm px-3 text-xs data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            Diagram
          </ToggleGroupItem>
          <ToggleGroupItem
            value="code"
            className="rounded-sm px-3 text-xs data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            Code
          </ToggleGroupItem>
        </ToggleGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-11 text-muted-foreground hover:text-foreground sm:size-8"
              aria-label="Copy code"
              onClick={async () => {
                try {
                  await copyToClipboard(source)
                  toast.success('Copied to clipboard')
                } catch {
                  toast.error('Unable to copy code')
                }
              }}
            >
              <Copy className="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy code</TooltipContent>
        </Tooltip>
        {diagram && !showCode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-11 text-muted-foreground hover:text-foreground sm:size-8"
                aria-label="Enlarge diagram"
                onClick={() => setExpanded(true)}
              >
                <Maximize2 className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Enlarge diagram</TooltipContent>
          </Tooltip>
        )}
      </div>
      {current?.error && (
        <p role="alert" className="px-4 pt-3 text-sm text-muted-foreground">
          Unable to render this diagram. The source is shown below.
          <span className="mt-1 block text-xs">{current.error}</span>
        </p>
      )}
      {!current && !showCode && (
        <p role="status" className="px-4 pt-3 text-sm text-muted-foreground">
          Rendering diagram…
        </p>
      )}
      {showCode || !diagram ? (
        <pre className="max-w-full overflow-x-auto p-4 text-sm">
          <code>{source}</code>
        </pre>
      ) : (
        diagram
      )}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="max-h-[90dvh] overflow-auto sm:max-w-[90vw]"
          aria-describedby={undefined}
        >
          <DialogTitle>Mermaid diagram</DialogTitle>
          <div className="min-w-0 [&_svg]:min-w-[700px]">{diagram}</div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
