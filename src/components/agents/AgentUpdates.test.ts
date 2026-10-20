import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/types/chat'
import { agentUpdateFeed } from './AgentUpdates'

const UPDATE = '[Jean agent update] Automatic message from Jean.'

function msg(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  timestamp: number
): ChatMessage {
  return { id, session_id: 's', role, content, timestamp, tool_calls: [] }
}

const messages = [
  msg('1', 'user', 'Fix issues', 100),
  msg('2', 'assistant', 'Started.', 101),
  msg('3', 'user', UPDATE, 200),
  msg('4', 'assistant', '#1 done.', 201),
  msg('5', 'user', UPDATE, 300),
  msg('6', 'assistant', '', 301),
  msg('7', 'assistant', '#2 done.', 302),
]

describe('agentUpdateFeed', () => {
  it('lists non-empty update replies newest first', () => {
    const { updates, unread } = agentUpdateFeed(messages, 0)
    expect(updates.map(m => m.id)).toEqual(['7', '4'])
    expect(unread).toBe(2)
  })

  it('counts only updates newer than the last seen one', () => {
    expect(agentUpdateFeed(messages, 201).unread).toBe(1)
  })

  it('treats updates before the last user prompt as read', () => {
    const withPrompt = [...messages, msg('8', 'user', 'Status?', 400)]
    expect(agentUpdateFeed(withPrompt, 0).unread).toBe(0)
  })
})
