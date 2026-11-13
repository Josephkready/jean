import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test/test-utils'
import type { Project } from '@/types/projects'
import { useProjectsStore } from '@/store/projects-store'
import { ProjectTree } from './ProjectTree'

vi.mock('@/services/projects', () => ({
  useReorderItems: () => ({ mutate: vi.fn() }),
  useMoveItem: () => ({ mutate: vi.fn() }),
  useCreateFolder: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./FolderTreeItem', () => ({
  FolderTreeItem: ({
    folder,
    children,
  }: {
    folder: Project
    children?: ReactNode
  }) =>
    createElement(
      'div',
      null,
      createElement('span', null, folder.name),
      children
    ),
}))
vi.mock('./ProjectTreeItem', () => ({
  ProjectTreeItem: ({ project }: { project: Project }) =>
    createElement('span', null, project.name),
}))

const projects: Project[] = [
  {
    id: 'local-1',
    name: 'Local One',
    path: '/tmp/local-1',
    default_branch: 'main',
    added_at: 1,
    order: 0,
  },
  {
    id: 'local-2',
    name: 'Local Two',
    path: '/tmp/local-2',
    default_branch: 'main',
    added_at: 2,
    order: 1,
  },
  {
    id: 'remote-1',
    name: 'Remote One',
    path: '/remote/remote-1',
    default_branch: 'main',
    added_at: 3,
    order: 2,
    serverId: 'server-1',
    serverName: 'Build box',
  },
]

describe('project instance controls', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      expandedFolderIds: new Set(),
      expandedProjectIds: new Set(),
      addProjectDialogOpen: false,
    })
  })

  it('uses one stateful expansion control beside each instance label', async () => {
    const user = userEvent.setup()
    render(
      createElement(ProjectTree, {
        projects,
        groupByServer: true,
      })
    )

    const actionGroups = screen.getAllByTestId('instance-title-actions')
    expect(actionGroups).toHaveLength(2)
    const [localActions, remoteActions] = actionGroups
    if (!localActions || !remoteActions) {
      throw new Error('Expected two instance action groups')
    }

    const localToggle = within(localActions).getByRole('button', {
      name: 'Expand all projects on Local',
    })
    const remoteToggle = within(remoteActions).getByRole('button', {
      name: 'Expand all projects on Build box',
    })
    expect(remoteToggle).toBeInTheDocument()

    await user.click(localToggle)

    expect(useProjectsStore.getState().expandedProjectIds).toEqual(
      new Set(['local-1', 'local-2'])
    )
    expect(
      within(localActions).getByRole('button', {
        name: 'Collapse all projects on Local',
      })
    ).toBeInTheDocument()
    expect(
      within(remoteActions).getByRole('button', {
        name: 'Expand all projects on Build box',
      })
    ).toBeInTheDocument()

    await user.click(
      within(localActions).getByRole('button', {
        name: 'Collapse all projects on Local',
      })
    )

    expect(useProjectsStore.getState().expandedProjectIds.size).toBe(0)
    expect(
      within(localActions).getByRole('button', {
        name: 'Expand all projects on Local',
      })
    ).toBeInTheDocument()
  })

  it('expands all projects in an instance when only a subset is expanded', async () => {
    const user = userEvent.setup()
    useProjectsStore.setState({
      expandedProjectIds: new Set(['local-1']),
    })

    render(
      createElement(ProjectTree, {
        projects,
        groupByServer: true,
      })
    )

    await user.click(
      screen.getByRole('button', { name: 'Expand all projects on Local' })
    )

    expect(useProjectsStore.getState().expandedProjectIds).toEqual(
      new Set(['local-1', 'local-2'])
    )
  })
})
