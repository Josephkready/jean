import { test, expect } from '../fixtures/tauri-mock'
import { worktree1, worktree2 } from '../fixtures/invoke-handlers'
import { createSession } from '../fixtures/mock-data'

// Regression for Josephkready/jean#6: on mobile the compact chat view hid
// every prompt before the latest one, so there was nothing to scroll up to.
const messages = [1, 2, 3, 4].flatMap(n => [
  {
    id: `u${n}`,
    session_id: 'history-session',
    role: 'user',
    content: `Prompt number ${n}`,
    timestamp: 1000 + n * 2,
    tool_calls: [],
  },
  {
    id: `a${n}`,
    session_id: 'history-session',
    role: 'assistant',
    content: `Answer number ${n}`,
    timestamp: 1001 + n * 2,
    tool_calls: [],
  },
])
const session = createSession({
  id: 'history-session',
  name: 'History',
  messages,
})

test.use({
  responseOverrides: {
    list_worktrees: [{ ...worktree1, sessions: [session] }, worktree2],
    get_session: session,
    get_sessions: { sessions: [session], active_session_id: session.id },
  },
})

test('mobile: earlier prompts stay reachable by scrolling up', async ({
  mockPage,
}) => {
  await mockPage.setViewportSize({ width: 390, height: 600 })
  await mockPage.getByText('fuzzy-tiger').click()

  await expect(mockPage.getByText('Answer number 4')).toBeVisible({
    timeout: 5000,
  })
  // Full history is rendered, not just the latest prompt.
  await expect(mockPage.getByText('Prompt number 1')).toBeAttached()
  await expect(mockPage.getByText('Answer number 1')).toBeAttached()

  const viewport = mockPage
    .locator('[data-slot="scroll-area-viewport"]')
    .filter({ hasText: 'Answer number 4' })
    .last()
  const scrollTop = await viewport.evaluate(el => {
    el.scrollTop = 0
    return { scrollable: el.scrollHeight > el.clientHeight, top: el.scrollTop }
  })
  expect(scrollTop.scrollable).toBe(true)
  await expect(mockPage.getByText('Prompt number 1')).toBeInViewport()
})
