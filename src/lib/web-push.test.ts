import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@/lib/transport'
import {
  decodePushKey,
  disablePush,
  enablePush,
  pushAvailability,
  registeredPushSubscription,
} from './web-push'
vi.mock('@/lib/transport', () => ({ invoke: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('Notification', {
    requestPermission: vi.fn().mockResolvedValue('granted'),
  })
  vi.stubGlobal('PushManager', function PushManager() {
    return undefined
  })
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: false,
  } as MediaQueryList)
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: true,
  })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {},
  })
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Desktop',
  })
})

function device() {
  let local: PushSubscription | null = null
  const sub = {
    endpoint: 'https://web.push.apple.com/test',
    options: { applicationServerKey: decodePushKey('AQID').buffer },
    toJSON: () => ({
      endpoint: 'https://web.push.apple.com/test',
      keys: { p256dh: 'public', auth: 'auth' },
    }),
    unsubscribe: vi.fn(async () => {
      local = null
      return true
    }),
  } as unknown as PushSubscription
  const registration = {
    pushManager: {
      getSubscription: async () => local,
      subscribe: async () => {
        local = sub
        return sub
      },
    },
  } as unknown as ServiceWorkerRegistration
  return { sub, registration, local: () => local }
}

describe('per-device push opt-in (issue #27)', () => {
  it('decodes URL-safe VAPID keys', () => {
    expect([...decodePushKey('-_8')]).toEqual([251, 255])
  })

  it('requires Home Screen installation on iPhone and HTTPS', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'iPhone',
    })
    expect(pushAvailability()).toContain('Add to Home Screen')
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    })
    expect(pushAvailability()).toContain('HTTPS')
  })

  it('requests permission during the tap, registers the subscription, then disables only this device', async () => {
    const d = device()
    const enabled = enablePush(d.registration, 'AQID')
    expect(Notification.requestPermission).toHaveBeenCalledOnce()
    expect(await enabled).toBe(d.sub)
    expect(d.local()).toBe(d.sub)
    await disablePush(d.sub)
    expect(d.local()).toBeNull()
  })

  it('rolls back browser opt-in when server registration fails', async () => {
    const d = device()
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Disconnected'))
    await expect(enablePush(d.registration, 'AQID')).rejects.toThrow(
      'Disconnected'
    )
    expect(d.local()).toBeNull()
  })

  it('preserves a reused browser subscription after failed registration (issue #27)', async () => {
    const d = device()
    await enablePush(d.registration, 'AQID')
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Disconnected'))
    await expect(enablePush(d.registration, 'AQID')).rejects.toThrow(
      'Disconnected'
    )
    expect(d.local()).toBe(d.sub)
    vi.mocked(invoke).mockResolvedValueOnce(false)
    expect(await registeredPushSubscription(d.registration)).toBeNull()
    vi.mocked(invoke).mockResolvedValueOnce(true)
    expect(await registeredPushSubscription(d.registration)).toBe(d.sub)
  })

  it('keeps the local subscription when persisting opt-out fails, so it can be retried', async () => {
    const d = device()
    await enablePush(d.registration, 'AQID')
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Disconnected'))
    await expect(disablePush(d.sub)).rejects.toThrow('Disconnected')
    expect(d.local()).toBe(d.sub)
  })

  it('does not show enabled when the server has lost the device subscription', async () => {
    const d = device()
    await enablePush(d.registration, 'AQID')
    vi.mocked(invoke).mockResolvedValueOnce(false)
    expect(await registeredPushSubscription(d.registration)).toBeNull()
    expect(d.local()).toBe(d.sub)
    vi.mocked(invoke).mockResolvedValueOnce(true)
    expect(await registeredPushSubscription(d.registration)).toBe(d.sub)
  })

  it('does not create a subscription after permission denial', async () => {
    const d = device()
    vi.mocked(Notification.requestPermission).mockResolvedValueOnce('denied')
    await expect(enablePush(d.registration, 'AQID')).rejects.toThrow(
      'not allowed'
    )
    expect(d.local()).toBeNull()
  })
})
