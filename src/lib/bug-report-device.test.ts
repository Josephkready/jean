import { describe, expect, it } from 'vitest'
import {
  deviceType,
  formatCliVersions,
  parseBrowser,
  parseOs,
} from './bug-report-device'

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  linuxFirefox:
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  linuxWebKitGtk:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)',
}

describe('parseOs', () => {
  it.each([
    [UA.iphone, 'iOS 18.1'],
    [UA.android, 'Android 15'],
    [UA.mac, 'macOS 10.15.7'],
    [UA.windowsEdge, 'Windows NT 10.0'],
    [UA.linuxFirefox, 'Linux'],
    ['', 'Unknown'],
  ])('%s → %s', (ua, expected) => {
    expect(parseOs(ua)).toBe(expected)
  })
})

describe('parseBrowser', () => {
  it.each([
    [UA.iphone, 'Safari 18.1'],
    [UA.android, 'Chrome 141'],
    [UA.windowsEdge, 'Edge 141'],
    [UA.linuxFirefox, 'Firefox 143'],
    // Tauri's Linux web view has no browser token.
    [UA.linuxWebKitGtk, 'WebKit 605'],
    ['', 'Unknown'],
  ])('%s → %s', (ua, expected) => {
    expect(parseBrowser(ua)).toBe(expected)
  })
})

describe('deviceType', () => {
  it('uses touch support and the short screen edge', () => {
    expect(deviceType(0, 390)).toBe('desktop')
    expect(deviceType(5, 390)).toBe('phone')
    expect(deviceType(5, 820)).toBe('tablet')
  })
})

describe('formatCliVersions', () => {
  it('lists only installed CLIs', () => {
    expect(
      formatCliVersions([
        { name: 'claude', version: '2.1.3' },
        { name: 'codex', version: null },
        { name: 'gh', version: '2.80.0' },
        { name: 'pi' },
      ])
    ).toBe('claude 2.1.3, gh 2.80.0')
  })
})
