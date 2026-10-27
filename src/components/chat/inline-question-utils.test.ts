import { describe, expect, it } from 'vitest'
import {
  inlineQuestionAnswer,
  parseInlineNumberedQuestion,
} from './inline-question-utils'

describe('parseInlineNumberedQuestion', () => {
  it('reads a question in the recap and removes the list from the text', () => {
    const text = [
      '## Recap',
      '',
      'Excalidraw has Select and Hand tools.',
      '',
      'Which mode do you want?',
      '',
      'Reply with a number:',
      '',
      '1. Select + Hand buttons (**my recommendation**)',
      '',
      '2. Strict `Excalidraw` modes',
      '3. Do not add modes',
      '',
      '- Waiting for your choice.',
    ].join('\n')

    expect(parseInlineNumberedQuestion(text)).toEqual({
      question: 'Which mode do you want?',
      options: [
        'Select + Hand buttons (my recommendation)',
        'Strict Excalidraw modes',
        'Do not add modes',
      ],
      rest: [
        '## Recap',
        '',
        'Excalidraw has Select and Hand tools.',
        '',
        'Which mode do you want?',
        '',
        '- Waiting for your choice.',
      ].join('\n'),
    })
  })

  it('accepts the cue after the list and on the question line', () => {
    expect(
      parseInlineNumberedQuestion(
        'Steps:\n1. Read\n2. Test\n\nHow next?\n1. Open a PR\n2. Keep working\n\nReply with the number.'
      )
    ).toMatchObject({
      question: 'How next?',
      options: ['Open a PR', 'Keep working'],
    })
    expect(
      parseInlineNumberedQuestion('Which one? Reply with a number:\n1. A\n2. B')
    ).toEqual({
      question: 'Which one?',
      options: ['A', 'B'],
      rest: 'Which one?',
    })
  })

  it('returns null without a cue next to a valid list', () => {
    expect(
      parseInlineNumberedQuestion('Steps:\n1. Read\n2. Write\n3. Test')
    ).toBeNull()
    expect(
      parseInlineNumberedQuestion(
        'Reply with a number later.\n\nSteps:\n1. Read\n2. Write'
      )
    ).toBeNull()
    expect(
      parseInlineNumberedQuestion('Reply with a number:\n1. Only one')
    ).toBeNull()
    expect(
      parseInlineNumberedQuestion('Reply with a number:\n1. A\n2. A')
    ).toBeNull()
  })
})

describe('inlineQuestionAnswer', () => {
  it('sends the number and the option text', () => {
    expect(inlineQuestionAnswer(['Alpha', 'Beta'], 1)).toBe('2. Beta')
  })
})
