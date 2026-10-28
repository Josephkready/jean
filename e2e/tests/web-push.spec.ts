import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../fixtures/tauri-mock'

// Optional static-build mode runs without starting a dev server.
test.beforeEach(async ({ page }) => {
  const directory = process.env.JEAN_E2E_STATIC_DIR
  if (!directory) return
  await page.route('https://jean-push.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    const file = path.join(
      directory,
      pathname === '/' ? 'index.html' : pathname
    )
    try {
      const body = await readFile(file)
      const ext = path.extname(file)
      const contentType =
        (
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
            '.wasm': 'application/wasm',
          } as Record<string, string>
        )[ext] ?? 'application/octet-stream'
      await route.fulfill({ body, contentType })
    } catch {
      await route.fulfill({ status: 404, body: 'Not found' })
    }
  })
})

// One opt-in/test/opt-out flow. Browser permission and the push service are
// platform seams; stub them here and use the ignored Rust live test for delivery.
test('web push can be enabled, tested, reopened and disabled on this device', async ({
  mockPage,
}, testInfo) => {
  await mockPage.evaluate(() => {
    let current: unknown = null
    let registered = false
    const state = { tests: 0, permissionRequests: 0 }
    const subscription = {
      endpoint: 'https://web.push.apple.com/e2e-device',
      options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
      toJSON: () => ({
        endpoint: 'https://web.push.apple.com/e2e-device',
        keys: { p256dh: 'public', auth: 'auth' },
      }),
      unsubscribe: async () => {
        current = null
        return true
      },
    }
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: function PushManager() {},
    })
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: {
        permission: 'default',
        requestPermission: async () => {
          state.permissionRequests++
          return 'granted'
        },
      },
    })
    const worker = {
      pushManager: {
        getSubscription: async () => current,
        subscribe: async () => {
          current = subscription
          return subscription
        },
      },
    }
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: async () => worker,
        ready: Promise.resolve(worker),
      },
    })
    const app = window as unknown as {
      __pushTest: typeof state
      __JEAN_E2E_MOCK__: { invokeHandlers: Record<string, () => unknown> }
    }
    app.__pushTest = state
    Object.assign(app.__JEAN_E2E_MOCK__.invokeHandlers, {
      get_web_push_key: () => 'AQID',
      has_web_push_subscription: () => registered,
      subscribe_web_push: () => {
        registered = true
      },
      unsubscribe_web_push: () => {
        registered = false
      },
      test_web_push: () => {
        state.tests++
      },
    })
  })
  await mockPage
    .getByRole('button', { name: 'Settings', exact: false })
    .first()
    .click()
  const panel = mockPage.getByTestId('web-push-settings')
  await expect(
    panel.getByRole('button', { name: 'Enable notifications' })
  ).toBeEnabled()
  await panel.getByRole('button', { name: 'Enable notifications' }).click()
  await expect(
    panel.getByText('Enabled on this device.', { exact: true })
  ).toBeVisible()
  await mockPage
    .getByText('Notifications', { exact: true })
    .scrollIntoViewIfNeeded()
  await mockPage.screenshot({ path: testInfo.outputPath('push-enabled.png') })
  await panel.getByRole('button', { name: 'Send test' }).click()
  await expect
    .poll(() =>
      mockPage.evaluate(
        () =>
          (window as unknown as { __pushTest: { tests: number } }).__pushTest
            .tests
      )
    )
    .toBe(1)
  await mockPage.keyboard.press('Escape')
  await mockPage
    .getByRole('button', { name: 'Settings', exact: false })
    .first()
    .click()
  await expect(
    panel.getByText('Enabled on this device.', { exact: true })
  ).toBeVisible()
  await panel.getByRole('button', { name: 'Disable notifications' }).click()
  await expect(
    panel.getByText('Off on this device.', { exact: true })
  ).toBeVisible()
  expect(
    await mockPage.evaluate(
      () =>
        (window as unknown as { __pushTest: { permissionRequests: number } })
          .__pushTest.permissionRequests
    )
  ).toBe(1)
})

test('iPhone web access explains Home Screen installation before requesting permission', async ({
  mockPage,
}, testInfo) => {
  await mockPage.setViewportSize({ width: 390, height: 844 })
  await mockPage.evaluate(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'iPhone',
    })
  })
  await mockPage.keyboard.press('ControlOrMeta+,')
  const general = mockPage.getByRole('button', { name: 'General', exact: true })
  if (await general.isVisible()) await general.click()
  const panel = mockPage.getByTestId('web-push-settings')
  await expect(panel.getByText(/Add to Home Screen/)).toBeVisible()
  await expect(
    panel.getByRole('button', { name: 'Enable notifications' })
  ).toHaveCount(0)
  await mockPage
    .getByText('Notifications', { exact: true })
    .scrollIntoViewIfNeeded()
  await mockPage.screenshot({
    path: testInfo.outputPath('push-iphone-guidance.png'),
  })
})
