import { expect, test } from '../fixtures/tauri-mock'

test.describe('iPadOS top bar safe-area and visualViewport clearance (#58)', () => {
  test.use({
    viewport: { width: 973, height: 938 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: false,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Safari/605.1.15',
  })

  test('keeps TitleBar buttons clear of iPadOS top bar, traffic lights, and visualViewport focus pan', async ({
    mockPage,
  }) => {
    // Configure standalone iPadOS signals + controllable visualViewport mock before app scripts read them
    await mockPage.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 })
      Object.defineProperty(navigator, 'standalone', {
        get: () => true,
        configurable: true,
      })
      const origMatchMedia = window.matchMedia.bind(window)
      window.matchMedia = ((query: string) => {
        if (query.includes('display-mode: standalone')) {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          } as MediaQueryList
        }
        return origMatchMedia(query)
      }) as typeof window.matchMedia

      const listeners = new Map<
        string,
        Set<EventListenerOrEventListenerObject>
      >()
      let vvOffsetTop = 0
      let vvHeight = 938
      const vv = {
        get offsetLeft() {
          return 0
        },
        get offsetTop() {
          return vvOffsetTop
        },
        get pageLeft() {
          return 0
        },
        get pageTop() {
          return vvOffsetTop
        },
        get width() {
          return 973
        },
        get height() {
          return vvHeight
        },
        get scale() {
          return 1
        },
        addEventListener(type: string, cb: EventListenerOrEventListenerObject) {
          if (!listeners.has(type)) listeners.set(type, new Set())
          listeners.get(type)!.add(cb)
        },
        removeEventListener(
          type: string,
          cb: EventListenerOrEventListenerObject
        ) {
          listeners.get(type)?.delete(cb)
        },
      }
      Object.defineProperty(window, 'visualViewport', {
        get: () => vv,
        configurable: true,
      })
      ;(window as unknown as Record<string, unknown>).__TRIGGER_VV__ = (
        offsetTop: number,
        height: number
      ) => {
        vvOffsetTop = offsetTop
        vvHeight = height
        for (const cb of listeners.get('resize') ?? []) {
          if (typeof cb === 'function') cb.call(vv, new Event('resize'))
          else cb.handleEvent(new Event('resize'))
        }
        for (const cb of listeners.get('scroll') ?? []) {
          if (typeof cb === 'function') cb.call(vv, new Event('scroll'))
          else cb.handleEvent(new Event('scroll'))
        }
      }
    })

    await mockPage.goto('/')
    await expect(mockPage.getByText('Test Project').first()).toBeVisible({
      timeout: 5000,
    })

    // Open SessionChatModal on fuzzy-tiger worktree (without manually injecting --safe-area-top,
    // verifying the iPadOS standalone fallback floor clears the 24px OS bar even when env() is 0px)
    await mockPage.getByText('fuzzy-tiger').first().click()
    const closeModalBtn = mockPage.getByRole('button', {
      name: 'Close',
      exact: true,
    })
    await expect(closeModalBtn).toBeVisible({
      timeout: 5000,
    })

    const ipadAttr = await mockPage.evaluate(
      () => document.documentElement.dataset.ipadStandalone
    )
    expect(ipadAttr).toBe('true')

    // 1. Left sidebar toggle button starts below 24px OS bar and to the right of 76px traffic lights
    const leftSidebarBtn = mockPage.getByRole('button', {
      name: /left sidebar/i,
    })
    const leftBtnBox = await leftSidebarBtn.boundingBox()
    expect(leftBtnBox).not.toBeNull()
    expect(leftBtnBox!.y).toBeGreaterThanOrEqual(24)
    expect(leftBtnBox!.x).toBeGreaterThanOrEqual(76)

    // 2. SessionChatModal header sits below TitleBar (24px safe-area + 32px TitleBar = 56px)
    const closeBtnBox = await closeModalBtn.boundingBox()
    expect(closeBtnBox).not.toBeNull()
    expect(closeBtnBox!.y).toBeGreaterThanOrEqual(56)

    // 3. Simulate Safari visualViewport focus pan (offsetTop=38, height=856)
    await mockPage.evaluate(() => {
      ;(
        window as unknown as {
          __TRIGGER_VV__: (offsetTop: number, height: number) => void
        }
      ).__TRIGGER_VV__(38, 856)
    })
    await mockPage.waitForTimeout(200)

    const pannedLeftBtnBox = await leftSidebarBtn.boundingBox()
    const pannedCloseBtnBox = await closeModalBtn.boundingBox()
    expect(pannedLeftBtnBox).not.toBeNull()
    expect(pannedCloseBtnBox).not.toBeNull()
    // Pinned inside the shifted visual viewport [offsetTop=38 .. 894] below the 24px safe-area
    expect(pannedLeftBtnBox!.y).toBeGreaterThanOrEqual(38 + 24)
    expect(pannedCloseBtnBox!.y).toBeGreaterThanOrEqual(38 + 56)
  })
})
