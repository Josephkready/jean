import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import type { MermaidBlock as MermaidBlockType } from './mermaid-block'

const { copy, success, error } = vi.hoisted(() => ({
  copy: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: copy }))
vi.mock('sonner', () => ({ toast: { success, error } }))

const source = 'flowchart TD\nA[Step A] --> B[Step B]'

// The loaded renderer is module state: load a fresh module per test.
let MermaidBlock: typeof MermaidBlockType
beforeEach(async () => {
  vi.resetModules()
  ;({ MermaidBlock } = await import('./mermaid-block'))
  vi.clearAllMocks()
  copy.mockResolvedValue(undefined)
})

describe('MermaidBlock', () => {
  it('groups view choices and keeps icon actions accessible', async () => {
    render(<MermaidBlock source={source} />)
    await screen.findByText('Step A')
    expect(
      screen.getByRole('radiogroup', { name: 'Diagram view' })
    ).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Diagram' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Copy code' }).textContent).toBe(
      ''
    )
    expect(
      screen.getByRole('button', { name: 'Enlarge diagram' }).textContent
    ).toBe('')
  })

  it('renders themeable SVG labels', async () => {
    const { container } = render(<MermaidBlock source={source} />)
    await screen.findByText('Step B')
    const svg = container.querySelector('svg.pele')
    expect(svg?.getAttribute('style')).toContain('var(--pele-fg')
  })

  it('renders synchronously when the block remounts', async () => {
    const { unmount } = render(<MermaidBlock source={source} />)
    await screen.findByText('Step A')
    unmount()
    render(<MermaidBlock source={source} />)
    expect(screen.getByText('Step A')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('updates the diagram when the source changes', async () => {
    const { rerender } = render(<MermaidBlock source={source} />)
    await screen.findByText('Step A')
    rerender(<MermaidBlock source={'flowchart TD\nC[New] --> D[Done]'} />)
    expect(screen.getByText('New')).toBeTruthy()
    expect(screen.queryByText('Step A')).toBeNull()
  })

  it('drops links and scripts from untrusted diagrams', async () => {
    const { container } = render(
      <MermaidBlock
        source={`${source}\nclick A "javascript:alert(1)"\nclick B "https://example.com"`}
      />
    )
    await screen.findByText('Step A')
    expect(container.querySelector('a, script, foreignObject')).toBeNull()
  })

  it('reports clipboard errors without claiming success', async () => {
    copy.mockRejectedValue(new Error('denied'))
    render(<MermaidBlock source={source} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('Unable to copy code')
    )
    expect(success).not.toHaveBeenCalled()
  })

  it('renders a diagram, switches to source and opens an enlarged view', async () => {
    render(<MermaidBlock source={source} />)
    await screen.findByText('Step A')
    fireEvent.click(screen.getByRole('radio', { name: 'Code' }))
    expect(screen.getByText(/flowchart TD/)).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge diagram' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('keeps invalid source readable and shows the parser error', async () => {
    render(<MermaidBlock source="invalid diagram" />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Unable to render this diagram\./)
    expect(alert.textContent?.length).toBeGreaterThan(
      'Unable to render this diagram. The source is shown below.'.length
    )
    expect(screen.getByText('invalid diagram')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enlarge diagram' })).toBeNull()
  })
})
