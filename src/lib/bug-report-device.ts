/**
 * Device and software facts for bug reports. Pure parsers take their inputs
 * as arguments so they can be tested without a browser.
 */

export interface DeviceSnapshot {
  deviceType: string
  os: string
  browser: string
  userAgent: string
  screen: string
  viewport: string
  pixelRatio: string
  touch: string
  colorScheme: string
  language: string
  timezone: string
  online: string
}

/** Best-effort OS name and version from a user agent string. */
export function parseOs(userAgent: string): string {
  const ios = /(?:iPhone|iPad|iPod).*? OS (\d+(?:_\d+)*)/.exec(userAgent)
  if (ios?.[1]) return `iOS ${ios[1].replace(/_/g, '.')}`
  const android = /Android (\d+(?:\.\d+)*)/.exec(userAgent)
  if (android?.[1]) return `Android ${android[1]}`
  if (/CrOS/.test(userAgent)) return 'ChromeOS'
  const mac = /Mac OS X (\d+(?:[._]\d+)*)/.exec(userAgent)
  if (mac?.[1]) return `macOS ${mac[1].replace(/_/g, '.')}`
  if (/Macintosh/.test(userAgent)) return 'macOS'
  const windows = /Windows NT (\d+\.\d+)/.exec(userAgent)
  if (windows?.[1]) return `Windows NT ${windows[1]}`
  if (/Linux/.test(userAgent)) return 'Linux'
  return 'Unknown'
}

/** Best-effort browser (or web view) name and major version. */
export function parseBrowser(userAgent: string): string {
  const rules: [RegExp, string][] = [
    [/Edg(?:A|iOS)?\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/FxiOS\/(\d+)/, 'Firefox'],
    [/CriOS\/(\d+)/, 'Chrome'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+(?:\.\d+)?).*Safari/, 'Safari'],
    [/AppleWebKit\/(\d+)/, 'WebKit'],
  ]
  for (const [pattern, name] of rules) {
    const match = pattern.exec(userAgent)
    if (match?.[1]) return `${name} ${match[1]}`
  }
  return 'Unknown'
}

/** Phone or tablet by touch support and the short screen edge. */
export function deviceType(maxTouchPoints: number, shortEdge: number): string {
  if (maxTouchPoints <= 0) return 'desktop'
  return shortEdge < 600 ? 'phone' : 'tablet'
}

/** "claude 2.1.3, codex 0.50.0" from installed CLI versions. */
export function formatCliVersions(
  entries: { name: string; version?: string | null }[]
): string {
  return entries
    .filter(entry => entry.version)
    .map(entry => `${entry.name} ${entry.version}`)
    .join(', ')
}

export function captureDeviceSnapshot(): DeviceSnapshot {
  const userAgent = navigator.userAgent
  const { width, height } = window.screen
  return {
    deviceType: deviceType(
      navigator.maxTouchPoints ?? 0,
      Math.min(width, height)
    ),
    os: parseOs(userAgent),
    browser: parseBrowser(userAgent),
    userAgent,
    screen: `${width}x${height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    pixelRatio: String(window.devicePixelRatio || 1),
    touch: String(navigator.maxTouchPoints ?? 0),
    colorScheme: window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: navigator.onLine ? 'yes' : 'no',
  }
}
