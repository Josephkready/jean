import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useUIStore } from '@/store/ui-store'
import { MinimizedCliUpdate } from './MinimizedCliUpdate'

describe('MinimizedCliUpdate', () => {
  beforeEach(() => useUIStore.setState({ minimizedCliUpdate: null }))

  it('shows reinstall progress and restores the modal', () => {
    useUIStore.getState().setMinimizedCliUpdate({
      type: 'codex',
      name: 'Codex CLI',
      target: 'Remote: devbox',
      kind: 'reinstall',
      progress: 42,
    })

    render(<MinimizedCliUpdate />)

    const indicator = screen.getByRole('button', {
      name: 'Codex CLI update (Remote: devbox): 42%',
    })
    expect(indicator).toHaveTextContent('Codex CLI')
    expect(indicator).toHaveTextContent('Remote: devbox')
    expect(indicator).toHaveTextContent('42%')

    fireEvent.click(indicator)
    expect(useUIStore.getState().minimizedCliUpdate).toBeNull()
  })

  it('shows Updating for terminal updates', () => {
    useUIStore.getState().setMinimizedCliUpdate({
      type: 'gh',
      name: 'GitHub CLI',
      target: 'Local',
      kind: 'terminal',
      progress: null,
    })

    render(<MinimizedCliUpdate />)

    expect(
      screen.getByRole('button', {
        name: 'GitHub CLI update (Local): Updating',
      })
    ).toHaveTextContent('Updating…')
  })
})
