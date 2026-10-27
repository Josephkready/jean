import { useEffect, useState } from 'react'
import { convertServerFileSrc, invokeForOptionalServer } from '@/lib/transport'

/**
 * Display URL for an image referenced in assistant markdown. URLs pass through,
 * app-data files use the asset protocol, and other local paths are read
 * through the owner-routed file reader.
 */
export function useImageSrc(
  src: string | undefined,
  serverId: string | undefined
): string | undefined {
  const isUrl = !src || /^(https?:|data:|blob:|asset:|\/api\/|#)/i.test(src)
  const isAppData = Boolean(src && /com\.jean\.desktop[/\\]/.test(src))
  const [loadedImage, setLoadedImage] = useState<{
    path: string
    serverId?: string
    url: string
  } | null>(null)

  // Screenshots can live outside app data and project roots (for example /tmp).
  // Use the same owner-routed file reader as the file viewer for those paths.
  useEffect(() => {
    if (!src || isUrl || isAppData) return
    let cancelled = false
    void invokeForOptionalServer<{ mimeType: string; data: string }>(
      serverId,
      'read_file_base64',
      { path: src }
    )
      .then(result => {
        if (!cancelled) {
          setLoadedImage({
            path: src,
            serverId,
            url: `data:${result.mimeType};base64,${result.data}`,
          })
        }
      })
      .catch(error => {
        if (!cancelled) console.error('Failed to load markdown image:', error)
      })
    return () => {
      cancelled = true
    }
  }, [src, serverId, isUrl, isAppData])

  if (isUrl) return src
  if (isAppData && src) return convertServerFileSrc(serverId, src)
  return loadedImage?.path === src && loadedImage?.serverId === serverId
    ? loadedImage.url
    : undefined
}
