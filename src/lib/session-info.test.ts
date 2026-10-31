import { describe, expect, it } from 'vitest'
import { formatSessionInfo, type SessionInfo } from './session-info'

const base: SessionInfo = {
  sessionId: 'jean-1',
  name: 'Fix bug',
  backend: 'claude',
  model: 'opus',
  backendSessionId: 'abc',
  worktreePath: '/w/x',
  transcriptPaths: ['/home/u/.claude/projects/-w-x/abc.jsonl'],
  runLogDir: '/data/sessions/data/jean-1',
}

describe('formatSessionInfo', () => {
  it('lists ids, worktree, transcript and run logs', () => {
    expect(formatSessionInfo(base)).toBe(
      [
        'Jean session: Fix bug (jean-1)',
        'Backend: claude (opus) session id: abc',
        'Worktree: /w/x',
        'Transcript: /home/u/.claude/projects/-w-x/abc.jsonl',
        'Jean run logs: /data/sessions/data/jean-1',
      ].join('\n')
    )
  })

  it('omits absent paths and flags a missing backend id', () => {
    const text = formatSessionInfo({
      ...base,
      model: null,
      backendSessionId: null,
      worktreePath: '',
      transcriptPaths: [],
      runLogDir: null,
    })
    expect(text).toBe(
      'Jean session: Fix bug (jean-1)\nBackend: claude (no backend session id yet)'
    )
  })

  it('emits one Transcript line per file', () => {
    const text = formatSessionInfo({ ...base, transcriptPaths: ['/a', '/b'] })
    expect(text).toContain('Transcript: /a\nTranscript: /b')
  })
})
