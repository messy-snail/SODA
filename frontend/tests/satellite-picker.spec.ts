import { expect, test } from '@playwright/test'
import { openSatelliteStep } from './rail'

const SHOTS = '../.cache/screenshots'

test('picked satellites gather in the basket and propagate together', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'pick')
  const sidebar = page.getByTestId('tool-sidebar')
  const basket = sidebar.getByTestId('satellite-basket')
  const query = sidebar.getByTestId('satellite-query').locator('input')

  // Suggestions stand in until something is picked, above the filter that starts on LEO; a
  // chip puts that satellite in the basket.
  await expect(sidebar.getByText('Suggested')).toBeVisible()
  await expect(sidebar.getByTestId('orbit-filter-LEO')).toHaveClass(/text-primary/)
  await expect(sidebar.getByTestId('orbit-filter-MEO')).not.toHaveClass(/text-primary/)
  await expect(basket).toContainText('Tick the satellites')
  await sidebar.getByTestId('pick-norad:25544').click()
  await expect(basket).toContainText('ISS (ZARYA)')

  // A row unfolds into its details; starring it puts it among the favourites.
  await basket.getByTestId('satellite-expand-norad:25544').click()
  await expect(basket.getByTestId('facts-norad:25544')).toContainText('Epoch')
  await basket.getByTestId('satellite-favorite').click()

  // While typing, matching favourites come first, ahead of the other results.
  await query.fill('ISS')
  const results = sidebar.getByTestId('search-results')
  await expect(sidebar.getByText('Favourites', { exact: true })).toBeVisible()
  await expect(results.getByTestId('satellite-row-norad:25544')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/picker-search-dark.png` })

  // The orbit filter narrows the list, even with nothing typed; the shelves stay above it.
  await query.fill('')
  await sidebar.getByTestId('orbit-filter-LEO').click()
  await sidebar.getByTestId('orbit-filter-GEO').click()
  await expect(sidebar.getByText('Favourites', { exact: true })).toBeVisible()
  const geoRow = results.locator('[data-testid^="satellite-row-norad:"]').first()
  await expect(geoRow).toBeVisible()
  await expect(results.locator('.v-chip', { hasText: 'LEO' })).toHaveCount(0)
  await geoRow.click()
  await expect(basket.locator('[data-testid^="satellite-row-"]')).toHaveCount(2)
  await page.screenshot({ path: `${SHOTS}/picker-filter-dark.png` })

  // Both propagate in one go and show up as two runs.
  await sidebar.getByTestId('to-propagate').click()
  await expect(sidebar.getByTestId('propagate-targets')).toContainText('2 satellites')
  await page.getByText('6 hours', { exact: true }).click()
  await page.screenshot({ path: `${SHOTS}/propagate-batch-dark.png` })
  await page.getByRole('button', { name: 'Propagate', exact: true }).click()
  // A GEO object's elements can be weeks old; that asks first, and going ahead still propagates.
  const runsStep = page.getByTestId('satellite-step-runs')
  const stale = page.getByTestId('stale-epoch-confirm')
  await expect(stale.or(runsStep.filter({ hasText: '2' }))).toBeVisible()
  if (await stale.isVisible()) await stale.click()
  await expect(runsStep).toContainText('2')
})

test('far from the epoch, propagation asks first and the globe says so', async ({ page }) => {
  const catalog = await (await page.request.get('/api/v1/catalog/25544')).json()
  const start = new Date(Date.parse(catalog.epoch) + 16 * 86_400_000).toISOString().slice(0, 16)
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'pick')
  const sidebar = page.getByTestId('tool-sidebar')
  await sidebar.getByTestId('satellite-query').locator('input').fill('25544')
  await sidebar.getByTestId('satellite-row-norad:25544').first().click()
  await sidebar.getByTestId('to-propagate').click()
  await sidebar.getByLabel('Start (UTC)').fill(start)
  await page.getByText('6 hours', { exact: true }).click()
  await page.getByRole('button', { name: 'Propagate', exact: true }).click()

  // Sixteen days out is "very low": the dialog lists the satellite, and cancelling propagates
  // nothing. A window that only reaches "low" (7-14 days) is shaded without asking.
  const dialog = page.getByTestId('stale-epoch')
  await expect(dialog).toContainText('ISS (ZARYA)')
  await expect(dialog).toContainText('very low')
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SHOTS}/stale-epoch-dialog-dark.png` })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('epoch-trust-badge')).toHaveCount(0)

  // Going ahead tints the globe and puts a badge over it while the clock is in that stretch.
  await page.getByRole('button', { name: 'Propagate', exact: true }).click()
  await page.getByTestId('stale-epoch-confirm').click()
  const badge = page.getByTestId('epoch-trust-badge')
  await expect(badge).toHaveAttribute('data-level', 'poor')
  await expect(badge).toContainText('ISS (ZARYA)')
  await expect(page.getByTestId('epoch-trust-tint')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/stale-epoch-globe-dark.png` })
})

test('pasted elements join the basket and leave it when deleted', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'pick')
  const sidebar = page.getByTestId('tool-sidebar')
  const basket = sidebar.getByTestId('satellite-basket')
  const catalog = await (await page.request.get('/api/v1/catalog/25544')).json()
  const name = `E2E ${Date.now()}`
  const text = sidebar.getByTestId('custom-text').locator('textarea:not(.v-textarea__sizer)')

  await sidebar.getByTestId('tab-custom').click()
  await sidebar.getByTestId('custom-name').locator('input').fill(`E2E bad ${Date.now()}`)
  await text.fill('not an element set')
  await sidebar.getByTestId('custom-save').click()
  await expect(sidebar.getByText('Could not read the elements')).toBeVisible()

  await sidebar.getByTestId('custom-name').locator('input').fill(name)
  await text.fill(catalog.tle.join('\n'))
  await sidebar.getByTestId('custom-save').click()
  await expect(basket).toContainText(name)
  await expect(basket).toContainText('User elements')
  await page.screenshot({ path: `${SHOTS}/picker-custom-dark.png` })

  const saved = sidebar.getByTestId('custom-elements').locator('.sat-item', { hasText: name })
  await saved.locator('[data-testid^="custom-delete-"]').click()
  await expect(saved).toHaveCount(0)
  await expect(basket).not.toContainText(name)
})

test('an element file saves every satellite in it without filling the basket', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'pick')
  const sidebar = page.getByTestId('tool-sidebar')
  const basket = sidebar.getByTestId('satellite-basket')
  const catalog = await (await page.request.get('/api/v1/catalog/25544')).json()
  const names = [`E2E FILE A ${Date.now()}`, `E2E FILE B ${Date.now()}`]
  const lines = names.flatMap((name) => [name, ...catalog.tle])
  const file = (text: string) => ({
    name: 'elements.tle',
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
  })

  await sidebar.getByTestId('tab-custom').click()
  const input = sidebar.getByTestId('element-file-input')
  const result = sidebar.getByTestId('element-file-result')
  await input.setInputFiles(file([...lines, 'a line that is no element set'].join('\n')))
  await expect(result).toContainText('Saved 2 of 3')
  await expect(result).toContainText('Skipped: a line that is no element set')
  const saved = sidebar.getByTestId('custom-elements').locator('.sat-item')
  for (const name of names) await expect(saved.filter({ hasText: name })).toHaveCount(1)
  await expect(basket).not.toContainText('E2E FILE')
  await page.screenshot({ path: `${SHOTS}/picker-file-import-dark.png` })

  // The same file again adds nothing: every record is already saved.
  await input.setInputFiles(file(lines.join('\n')))
  await expect(result).toContainText('Saved 0 of 2')
  await expect(result).toContainText('already saved')

  await input.setInputFiles(file('CCSDS_OEM_VERS = 2.0\n'))
  await expect(sidebar.getByText('OEM files do not hold orbital elements')).toBeVisible()

  for (const name of names) {
    await saved.filter({ hasText: name }).locator('[data-testid^="custom-delete-"]').click()
    await expect(saved.filter({ hasText: name })).toHaveCount(0)
  }
})
