import { describe, expect, it } from 'vitest'
import {
  computeOpenScrollTop,
  findOpenScrollAnchor,
  OPEN_SCROLL_ANCHOR_ATTR,
} from './open-scroll-target'

// Issue #26: opening a chat should land on the top of the recap, not the bottom.
describe('computeOpenScrollTop', () => {
  it('places the anchor at the top of the viewport', () => {
    expect(
      computeOpenScrollTop({
        anchorOffsetTop: 1500,
        scrollTop: 0,
        clientHeight: 700,
        scrollHeight: 3000,
      })
    ).toBe(1492)
  })

  it('accounts for the current scroll offset', () => {
    expect(
      computeOpenScrollTop({
        anchorOffsetTop: -100,
        scrollTop: 1000,
        clientHeight: 700,
        scrollHeight: 3000,
      })
    ).toBe(892)
  })

  it('clamps to the bottom when the recap is shorter than the viewport', () => {
    expect(
      computeOpenScrollTop({
        anchorOffsetTop: 2900,
        scrollTop: 0,
        clientHeight: 700,
        scrollHeight: 3000,
      })
    ).toBe(2300)
  })

  it('returns null when the chat does not overflow', () => {
    expect(
      computeOpenScrollTop({
        anchorOffsetTop: 10,
        scrollTop: 0,
        clientHeight: 700,
        scrollHeight: 700,
      })
    ).toBeNull()
  })
})

describe('findOpenScrollAnchor', () => {
  const html = (inner: string) => {
    const root = document.createElement('div')
    root.innerHTML = inner
    return root
  }

  it('prefers the Recap heading inside the latest answer', () => {
    const root = html(
      `<div ${OPEN_SCROLL_ANCHOR_ATTR}><h2>Details</h2><p>x</p><h2 id="r">Recap</h2><ul><li>y</li></ul></div>`
    )
    expect(findOpenScrollAnchor(root)?.id).toBe('r')
  })

  it('falls back to the answer wrapper when there is no recap heading', () => {
    const root = html(
      `<div id="a" ${OPEN_SCROLL_ANCHOR_ATTR}><h2>Details</h2></div>`
    )
    expect(findOpenScrollAnchor(root)?.id).toBe('a')
  })

  it('returns null when no finished answer is rendered', () => {
    expect(findOpenScrollAnchor(html('<p>hi</p>'))).toBeNull()
  })
})
