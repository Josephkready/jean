/* global self, URL */
/* Push only: no fetch handler or offline cache, so Jean always loads current assets. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event =>
  event.waitUntil(self.clients.claim())
)

self.addEventListener('push', event => {
  let payload = {}
  try {
    payload = event.data?.json() ?? {}
  } catch {
    /* Always display a notification. */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Jean', {
      body: payload.body || 'Open Jean to view your sessions.',
      icon: '/apple-touch-icon.png',
      badge: '/favicon.png',
      tag: payload.tag || 'jean',
      data: { url: '/' },
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const client = windows.find(
        client => new URL(client.url).origin === self.location.origin
      )
      if (client) return client.focus()
      return self.clients.openWindow(new URL('/', self.location.origin).href)
    })()
  )
})
