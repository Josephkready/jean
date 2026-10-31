import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { focusChatInputUnlessBusy } from './focus-chat-input'

// Regression for #13: a run finishing re-focused the chat input and stole the
// cursor from the bug report textarea.
describe('focusChatInputUnlessBusy', () => {
  function setup() {
    const chatRef = createRef<HTMLTextAreaElement>()
    const view = render(
      <div>
        <textarea ref={chatRef} data-testid="chat" />
        <div role="dialog">
          <textarea data-testid="dialog-textarea" />
          <button data-testid="dialog-button" />
        </div>
        <input data-testid="outside-input" />
      </div>
    )
    return { chatRef, ...view }
  }

  it('focuses the chat input when nothing else is focused', () => {
    const { chatRef } = setup()
    focusChatInputUnlessBusy(chatRef)
    expect(document.activeElement).toBe(chatRef.current)
  })

  it('does not steal focus from a textarea inside an open dialog', () => {
    const { chatRef, getByTestId } = setup()
    const field = getByTestId('dialog-textarea')
    field.focus()
    focusChatInputUnlessBusy(chatRef)
    expect(document.activeElement).toBe(field)
  })

  it('does not steal focus from a non-editable element inside a dialog', () => {
    const { chatRef, getByTestId } = setup()
    const button = getByTestId('dialog-button')
    button.focus()
    focusChatInputUnlessBusy(chatRef)
    expect(document.activeElement).toBe(button)
  })

  it('does not steal focus from another editable element', () => {
    const { chatRef, getByTestId } = setup()
    const input = getByTestId('outside-input')
    input.focus()
    focusChatInputUnlessBusy(chatRef)
    expect(document.activeElement).toBe(input)
  })
})
