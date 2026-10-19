import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('sample trip renders three real routes and interactive checkpoints', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('.route-card')).toHaveCount(3)
  await expect(page.locator('.sample-note')).toContainText('synthetic weather')
  await expect(page.locator('.recommend-tag')).toHaveCount(1)
  await page.locator('.route-card').first().click()
  await expect(page.locator('.route-card').first()).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'View checkpoint 3 on map', exact: true }).click()
  await expect(page.locator('.checkpoint-popup')).toBeVisible()
  await expect(page.locator('.checkpoint-popup')).toContainText('CHECKPOINT 03')
  expect(errors).toEqual([])
  await page.screenshot({ path: '../output/desktop.png', fullPage: true })
})

test('forecast slider paints locally and play/pause works', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.route-card')).toHaveCount(3)
  const apiCalls: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('/api/')) apiCalls.push(req.url())
  })
  const slider = page.getByRole('slider', { name: 'Forecast hours after departure' })
  await slider.fill('48')
  await expect(page.locator('.forecast-relative')).toHaveText('Departure + 48h')
  await page.getByRole('combobox', { name: 'Weather heatmap metric' }).selectOption('wind')
  await page.getByRole('button', { name: 'Play forecast animation' }).click()
  await expect.poll(async () => slider.inputValue()).not.toBe('48')
  await page.getByRole('button', { name: 'Pause forecast animation' }).click()
  expect(apiCalls).toHaveLength(0)
})

test('mobile layout fits and risk dialog supports Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.route-card')).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('button', { name: 'How it works', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('30,000 lb')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.screenshot({ path: '../output/mobile.png', fullPage: true })
})

test('changed inputs show stale result notice and sample recalculates spacing', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.route-card')).toHaveCount(3)
  await page.getByRole('button', { name: '10 miles', exact: true }).click()
  await expect(page.locator('.alert.pending')).toBeVisible()
  const response = page.waitForResponse(
    (res) => res.url().includes('/api/demo/') && res.url().includes('interval_miles=10'),
  )
  await page.getByRole('button', { name: 'Explore sample trip' }).click()
  await response
  await expect(page.locator('.alert.pending')).not.toBeVisible()
  await expect(page.locator('.routes-section-heading')).toContainText('Every 10 miles')
})

test('provider failures are shown and keep the previous trip', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.route-card')).toHaveCount(3)
  await page.route('**/api/plan/', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Routing provider is temporarily unavailable.' }),
    }),
  )
  await page.getByRole('button', { name: 'Find the safest route' }).click()
  await expect(page.getByRole('alert')).toContainText('previous trip remains displayed')
  await expect(page.locator('.route-card')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Find the safest route' })).toBeEnabled()
})

test('place search is selectable by keyboard', async ({ page }) => {
  await page.route('**/api/geocode/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            name: 'Boston',
            label: 'Boston, Massachusetts, United States',
            lat: 42.36,
            lng: -71.06,
            timezone: 'America/New_York',
          },
        ],
      }),
    }),
  )
  await page.goto('/')
  await expect(page.locator('.route-card')).toHaveCount(3)
  const origin = page.getByRole('combobox', { name: 'Origin', exact: true })
  await origin.fill('Boston')
  await expect(page.getByRole('option', { name: /Boston/ })).toBeVisible()
  await origin.press('ArrowDown')
  await origin.press('Enter')
  await expect(origin).toHaveValue('Boston, Massachusetts')
  await expect(page.getByRole('listbox')).not.toBeVisible()
})

test('core planner has no serious accessibility violations', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.route-card')).toHaveCount(3)
  const results = await new AxeBuilder({ page }).exclude('.leaflet-container').analyze()
  const serious = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  )
  expect(
    serious.map((v) => ({
      id: v.id,
      description: v.description,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([])
})
