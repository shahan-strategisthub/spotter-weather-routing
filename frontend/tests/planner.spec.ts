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
  const canvas = page.locator('canvas.forecast-canvas')
  const firstFrame = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())
  const recommendation = await page.locator('.recommendation-explanation').innerText()
  await slider.fill('48')
  await expect(page.locator('.forecast-relative')).toHaveText('Departure + 48h')
  await expect
    .poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL()))
    .not.toBe(firstFrame)
  await expect(page.locator('.recommendation-explanation')).toHaveText(recommendation)
  await page.getByRole('combobox', { name: 'Weather heatmap metric' }).selectOption('wind')
  await page.getByRole('button', { name: 'Play forecast animation' }).click()
  await expect.poll(async () => slider.inputValue()).not.toBe('48')
  await page.getByRole('button', { name: 'Pause forecast animation' }).click()
  expect(apiCalls).toHaveLength(0)
})

test('weather and checkpoint switches work with pointer and keyboard', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.route-card')).toHaveCount(3)
  const weather = page.getByRole('checkbox', { name: 'Weather', exact: true })
  const checkpoints = page.getByRole('checkbox', { name: 'Checkpoints', exact: true })
  await weather.uncheck()
  await expect(page.locator('canvas.forecast-canvas')).toHaveCount(0)
  await weather.check()
  await expect(page.locator('canvas.forecast-canvas')).toHaveCount(1)
  await checkpoints.uncheck()
  await page.getByRole('button', { name: 'View checkpoint 3 on map', exact: true }).click()
  await expect(checkpoints).toBeChecked()
  await expect(page.locator('.checkpoint-popup')).toBeVisible()
  await weather.focus()
  await weather.press('Space')
  await expect(weather).not.toBeChecked()
})

test('no-travel routes never display a recommendation', async ({ page }) => {
  const response = await page.request.get('/api/demo/')
  const data = await response.json()
  for (const route of data.routes) {
    route.summary.eligible = false
    route.summary.worst_level = 4
    route.summary.worst_label = 'No Travel'
    route.summary.risk_miles = {
      Low: 0,
      Moderate: 0,
      High: 0,
      Severe: 0,
      'No Travel': route.distance_miles,
      Unknown: 0,
    }
    route.summary.average_risk = 4
  }
  data.recommended_route_id = null
  data.recommendation_reason =
    'No route can be recommended: every option has no-travel conditions or missing forecasts.'
  await page.route('**/api/demo/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }),
  )
  await page.goto('/')
  await expect(page.locator('.route-card')).toHaveCount(3)
  await expect(page.locator('.recommend-tag')).toHaveCount(0)
  await expect(page.locator('.no-recommendation')).toContainText('No route can be recommended')
  await expect(page.locator('.route-blocked')).toHaveCount(3)
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
