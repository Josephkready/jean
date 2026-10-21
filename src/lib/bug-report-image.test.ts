import { describe, expect, it } from 'vitest'
import {
  bytesToBase64,
  fitWithin,
  imageFilesFrom,
  jpegName,
} from './bug-report-image'

describe('fitWithin', () => {
  it('caps the long edge and keeps the aspect ratio', () => {
    expect(fitWithin(3200, 1800)).toEqual({ width: 1600, height: 900 })
    expect(fitWithin(1170, 2532)).toEqual({ width: 739, height: 1600 })
  })

  it('never upscales a small image', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 })
  })
})

describe('imageFilesFrom', () => {
  const item = (kind: string, type: string, file: File | null) => ({
    kind,
    type,
    getAsFile: () => file,
  })

  it('keeps image files and ignores text and other files', () => {
    const png = new File(['x'], 'shot.png', { type: 'image/png' })
    const files = imageFilesFrom([
      item('string', 'text/plain', null),
      item('file', 'image/png', png),
      item('file', 'application/pdf', new File(['x'], 'a.pdf')),
    ])
    expect(files).toEqual([png])
  })

  it('returns nothing for a text-only paste', () => {
    expect(imageFilesFrom([item('string', 'text/plain', null)])).toEqual([])
  })
})

describe('jpegName', () => {
  it('replaces the extension with .jpg', () => {
    expect(jpegName('Screen Shot 2026.png')).toBe('Screen Shot 2026.jpg')
    expect(jpegName('photo.HEIC')).toBe('photo.jpg')
    expect(jpegName('.png')).toBe('screenshot.jpg')
  })
})

describe('bytesToBase64', () => {
  it('encodes bytes without a data: prefix', () => {
    expect(bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x10]))).toBe(
      '/9j/ABA='
    )
  })

  it('encodes inputs larger than one chunk', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 3).fill(0x41)
    expect(atob(bytesToBase64(bytes))).toBe('A'.repeat(bytes.length))
  })
})
