import { describe, expect, it } from 'vitest'
import {
  inlineQuestionAnswer,
  parseInlineNumberedQuestion,
} from './inline-question-utils'

describe('parseInlineNumberedQuestion', () => {
  it('reads the numbered options after a reply-with-a-number cue', () => {
    const text = [
      'Which mode do you want?',
      '',
      'Reply with a number:',
      '',
      '1. Select + Hand buttons (**my recommendation**)',
      '',
      '2. Strict `Excalidraw` modes',
      '3. Do not add modes',
      '',
      '## Recap',
      '',
      '- Waiting for your choice (1, 2 or 3).',
      '1. Not an option',
      '2. Also not an option',
    ].join('\n')

    expect(parseInlineNumberedQuestion(text)).toEqual({
      question: 'Which mode do you want?',
      options: [
        'Select + Hand buttons (my recommendation)',
        'Strict Excalidraw modes',
        'Do not add modes',
      ],
      multiple: false,
    })
  })

  it('uses the last numbered list when the cue follows the list', () => {
    const text = [
      'Steps I did:',
      '1. Read the code',
      '2. Ran tests',
      '',
      'How should I continue?',
      '1. Open a PR',
      '2. Keep working',
      '',
      'Reply with the number.',
    ].join('\n')

    expect(parseInlineNumberedQuestion(text)).toEqual({
      question: 'How should I continue?',
      options: ['Open a PR', 'Keep working'],
      multiple: false,
    })
  })

  it('keeps a question that shares its line with the cue', () => {
    expect(
      parseInlineNumberedQuestion('Which one? Reply with a number:\n1. A\n2. B')
        ?.question
    ).toBe('Which one?')
    expect(
      parseInlineNumberedQuestion('Reply with a number:\n1. A\n2. B')?.question
    ).toBe('Choose an option')
  })

  it('returns null without the cue or without a valid list', () => {
    expect(
      parseInlineNumberedQuestion('Steps:\n1. Read\n2. Write\n3. Test')
    ).toBeNull()
    expect(
      parseInlineNumberedQuestion('Reply with a number:\n1. Only one')
    ).toBeNull()
    expect(
      parseInlineNumberedQuestion('Reply with a number:\n1. A\n3. B')
    ).toBeNull()
    expect(
      parseInlineNumberedQuestion('Reply with a number:\n1. A\n2. A')
    ).toBeNull()
  })
})

describe('inlineQuestionAnswer', () => {
  it('sends the number and the option text', () => {
    const question = {
      question: 'Pick',
      options: ['Alpha', 'Beta'],
      multiple: false,
    }
    expect(inlineQuestionAnswer(question, 'Beta')).toBe('2. Beta')
  })
})
