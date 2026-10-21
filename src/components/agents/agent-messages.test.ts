import { describe, expect, it } from 'vitest'
import type { AgentTask } from '@/services/agents'
import type { ChatMessage } from '@/types/chat'
import {
  agentMessageLink,
  assistantReplyItems,
  conversationEntries,
  findRequestTask,
  parseAgentRequest,
  parseAgentSentMessage,
} from './agent-messages'

function assistant(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'a1',
    session_id: 's1',
    role: 'assistant',
    content: '',
    timestamp: 100,
    content_blocks: [],
    tool_calls: [],
    ...partial,
  }
}

function user(content: string, id = 'u1'): ChatMessage {
  return assistant({ id, role: 'user', content })
}

// Same text as `compose_update` + `message_agent` in jean-core
const REQUEST_UPDATE =
  '[Jean agent update] Automatic message from Jean, not from the user.\n\n' +
  '### 1. message\nRequest from agent Haruvo (`ag-1`):\n\nCheck the build.\n\n' +
  'Your final reply in this turn is sent back to Haruvo automatically.\n\n' +
  'Decide the next step.'

describe('agentMessageLink', () => {
  it('reads message_agent calls', () => {
    expect(
      agentMessageLink({
        id: 't1',
        name: 'mcp__jean__message_agent',
        input: { agentId: 'ag-2', message: 'hi' },
      })
    ).toEqual({ kind: 'agent', toolId: 't1', agentId: 'ag-2', message: 'hi' })
  })

  it('reads send_chat_message calls with the target name from the result', () => {
    expect(
      agentMessageLink({
        id: 't2',
        name: 'mcp__jean__send_chat_message',
        input: { sessionId: 's9', message: 'go' },
        output: JSON.stringify({
          sessionId: 's9',
          status: 'started',
          worktreeId: 'w9',
          worktreePath: '/tmp/w9',
          sessionName: 'integrate Beacon',
          worktreeName: 'Haruvo',
        }),
      })
    ).toEqual({
      kind: 'session',
      toolId: 't2',
      sessionId: 's9',
      message: 'go',
      worktreeId: 'w9',
      worktreePath: '/tmp/w9',
      name: 'Haruvo: integrate Beacon',
    })
  })

  it('ignores failed calls and other tools', () => {
    expect(
      agentMessageLink({
        id: 't3',
        name: 'mcp__jean__message_agent',
        input: { agentId: 'x', message: 'm' },
        is_error: true,
      })
    ).toBeNull()
    expect(
      agentMessageLink({ id: 't4', name: 'Bash', input: { command: 'ls' } })
    ).toBeNull()
  })
})

describe('assistantReplyItems', () => {
  it('keeps text and message links in order', () => {
    const message = assistant({
      timestamp: 42,
      content_blocks: [
        { type: 'text', text: 'Asking Grok.' },
        { type: 'tool_use', tool_call_id: 'read' },
        { type: 'tool_use', tool_call_id: 'msg' },
        { type: 'text', text: 'Done.' },
      ],
      tool_calls: [
        { id: 'read', name: 'Read', input: {} },
        {
          id: 'msg',
          name: 'mcp__jean__message_agent',
          input: { agentId: 'grok', message: 'help' },
        },
      ],
    })
    expect(assistantReplyItems([{ message }])).toEqual([
      { type: 'text', texts: ['Asking Grok.'] },
      {
        type: 'link',
        sentAt: 42,
        link: {
          kind: 'agent',
          toolId: 'msg',
          agentId: 'grok',
          message: 'help',
        },
      },
      { type: 'text', texts: ['Done.'] },
    ])
  })
})

describe('parseAgentSentMessage', () => {
  it('reads the marker that agent_message_text writes', () => {
    expect(
      parseAgentSentMessage(
        '[Message from agent Grok Bot (`ag-1`)]\n\nPull main.'
      )
    ).toEqual({ agentName: 'Grok Bot', agentId: 'ag-1', text: 'Pull main.' })
    expect(parseAgentSentMessage('Pull main.')).toBeNull()
  })
})

describe('parseAgentRequest', () => {
  it('reads a message_agent request inside an update', () => {
    expect(parseAgentRequest(REQUEST_UPDATE)).toEqual({
      agentName: 'Haruvo',
      agentId: 'ag-1',
      text: 'Check the build.',
    })
    expect(parseAgentRequest('Request from agent X (`y`):\n\nz')).toBeNull()
  })
})

describe('conversationEntries', () => {
  it('labels agent requests, user prompts and replies; drops other updates', () => {
    const entries = conversationEntries([
      user(REQUEST_UPDATE, 'u1'),
      assistant({ id: 'a1', content: 'Build is green.' }),
      user(
        '[Jean agent update] Automatic message\n\n### 1. delegation\nx',
        'u2'
      ),
      assistant({ id: 'a2', content: 'Noted.' }),
      user('Also check lint', 'u3'),
    ])
    expect(entries.map(e => [e.from, e.text])).toEqual([
      ['sender', 'Check the build.'],
      ['target', 'Build is green.'],
      ['target', 'Noted.'],
      ['user', 'Also check lint'],
    ])
  })
})

describe('findRequestTask', () => {
  const task = (id: number, createdAt: number, title: string): AgentTask => ({
    id,
    agentId: 'grok',
    sessionId: `s${id}`,
    title,
    kind: 'message',
    status: 'done',
    summary: null,
    createdAt,
    updatedAt: createdAt,
  })

  it('picks the first request task from the sender after the send', () => {
    const tasks = [
      task(1, 50, 'Request from Haruvo'),
      task(2, 120, 'Request from Haruvo'),
      task(3, 101, 'Request from Other'),
      task(4, 102, 'Request from Haruvo'),
    ]
    expect(findRequestTask(tasks, 'Haruvo', 100)?.id).toBe(4)
    expect(findRequestTask(tasks, 'Haruvo', 200)).toBeUndefined()
  })
})
