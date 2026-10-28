import { invoke } from '@/lib/transport'

export function pushAvailability(): string | null {
  if (!window.isSecureContext)
    return 'Notifications require a secure HTTPS connection.'
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (ios && !standalone) {
    return 'On iPhone or iPad, use Share → Add to Home Screen. Open Jean from its icon, then enable notifications here.'
  }
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return 'This browser does not support push notifications. Try a current browser.'
  }
  return null
}

export function decodePushKey(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(
    atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')),
    c => c.charCodeAt(0)
  )
}

export async function preparePush(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/push-sw.js', { scope: '/' })
  return navigator.serviceWorker.ready
}

/** Browser state alone does not prove that this server still has the device. */
export async function registeredPushSubscription(
  registration: ServiceWorkerRegistration
): Promise<PushSubscription | null> {
  if (Notification.permission === 'denied') return null
  const current = await registration.pushManager.getSubscription()
  if (!current) return null
  return (await invoke<boolean>('has_web_push_subscription', {
    endpoint: current.endpoint,
  }))
    ? current
    : null
}

/** Must be called directly by a click handler, before any asynchronous work. */
export async function enablePush(
  registration: ServiceWorkerRegistration,
  publicKey: string
): Promise<PushSubscription> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted')
    throw new Error(
      'Notifications were not allowed. Check this app’s notification permissions in device settings.'
    )
  let subscription = await registration.pushManager.getSubscription()
  if (subscription) {
    const previousKey = subscription.options.applicationServerKey
    const expected = decodePushKey(publicKey)
    if (
      !previousKey ||
      previousKey.byteLength !== expected.length ||
      new Uint8Array(previousKey).some(
        (byte, index) => byte !== expected[index]
      )
    ) {
      await subscription.unsubscribe()
      subscription = null
    }
  }
  let created = false
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodePushKey(publicKey),
    })
    created = true
  }
  try {
    await invoke('subscribe_web_push', { subscription: subscription.toJSON() })
  } catch (error) {
    // Roll back only a subscription created by this attempt; keep a reused one.
    if (created) {
      try {
        if (!(await subscription.unsubscribe())) {
          console.warn(
            'Browser push rollback failed after server registration failure'
          )
        }
      } catch (rollbackError) {
        console.warn(
          'Browser push rollback failed after server registration failure',
          rollbackError
        )
      }
    }
    throw error
  }
  return subscription
}

export async function disablePush(
  subscription: PushSubscription
): Promise<void> {
  // Persist opt-out before removing the local capability. Retrying is safe.
  await invoke('unsubscribe_web_push', { endpoint: subscription.endpoint })
  if (!(await subscription.unsubscribe())) {
    throw new Error(
      'Notifications are off on the server, but this browser kept its local subscription. Try again to finish disabling.'
    )
  }
}
