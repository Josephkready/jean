import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {}
  const notifications: unknown[] = []
  let focused = false
  let opened: string | null = null
  let windows: { url: string; focus: () => Promise<void> }[] = []
  const self = {
    addEventListener: (name: string, handler: (event: unknown) => void) => {
      handlers[name] = handler
    },
    location: { origin: 'https://jean.example' },
    registration: {
      showNotification: async (title: string, options: unknown) => {
        notifications.push({ title, options })
      },
    },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened = url
      },
    },
  }
  runInNewContext(readFileSync('public/push-sw.js', 'utf8'), { self, URL })
  return {
    notifications,
    opened: () => opened,
    focused: () => focused,
    existingWindow: () => {
      windows = [
        {
          url: 'https://jean.example/?token=private',
          focus: async () => {
            focused = true
          },
        },
      ]
    },
    dispatch: async (type: string, data: unknown) => {
      let task: Promise<unknown> = Promise.resolve()
      handlers[type]?.({
        data: { json: () => data },
        notification: {
          close: () => undefined,
          data: { url: 'https://evil.example' },
        },
        waitUntil: (promise: Promise<unknown>) => {
          task = promise
        },
      })
      await task
    },
  }
}

describe('push service worker', () => {
  it('shows encrypted-payload content as an OS notification and opens only Jean', async () => {
    const w = worker()
    await w.dispatch('push', {
      title: 'Session finished',
      body: 'Open Jean',
      tag: 'jean-session',
    })
    expect(w.notifications).toEqual([
      {
        title: 'Session finished',
        options: {
          body: 'Open Jean',
          icon: '/apple-touch-icon.png',
          badge: '/favicon.png',
          tag: 'jean-session',
          data: { url: '/' },
        },
      },
    ])
    await w.dispatch('notificationclick', null)
    expect(w.opened()).toBe('https://jean.example/')
  })
  it('focuses an existing Jean window without exposing or replacing its auth URL', async () => {
    const w = worker()
    w.existingWindow()
    await w.dispatch('notificationclick', null)
    expect(w.focused()).toBe(true)
    expect(w.opened()).toBeNull()
  })
  it('shows a fallback notification for an empty push', async () => {
    const w = worker()
    await w.dispatch('push', null)
    expect(w.notifications).toEqual([
      expect.objectContaining({ title: 'Jean' }),
    ])
  })
})
