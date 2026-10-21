/**
 * Screenshot staging for bug reports. Every image is decoded onto a canvas and
 * re-encoded as JPEG before upload; the server checks the same limits again.
 */

export const MAX_SCREENSHOTS = 3
export const MAX_SCREENSHOT_BYTES = 2_000_000
const MAX_LONG_EDGE = 1600
const JPEG_QUALITY = 0.82

export interface StagedScreenshot {
  id: string
  name: string
  blob: Blob
  previewUrl: string
}

/** Scale (width, height) so the long edge is at most `max`. Never upscales. */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_LONG_EDGE
): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  if (longEdge <= max) return { width, height }
  const scale = max / longEdge
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Image files from a paste or drop. Text items are ignored. */
export function imageFilesFrom(
  items: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }>
): File[] {
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return files
}

/** "screenshot.png" → "screenshot.jpg" (the upload is always JPEG). */
export function jpegName(name: string): string {
  const stem = name.replace(/\.[^.]*$/, '').trim()
  return `${stem || 'screenshot'}.jpg`
}

/** Decode, downscale and re-encode one image. Throws a user-facing message. */
export async function compressScreenshot(file: File): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(
      "This image format isn't supported. Try again or choose a JPEG or PNG."
    )
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not process the image.')
  // JPEG has no alpha: paint white under transparent screenshots.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  )
  if (!blob) throw new Error('Could not process the image.')
  if (blob.size > MAX_SCREENSHOT_BYTES) {
    throw new Error('Image too large even after compression.')
  }
  return blob
}

/** Base64 without the `data:` prefix, for the JSON command transport. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
}
