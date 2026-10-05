import { expect, test, type Page } from '@playwright/test'
import type { Viewer } from 'cesium'
import { openTool } from './rail'

const SHOTS = '../.cache/screenshots'

type SodaWindow = Window & { __sodaViewer?: Viewer }

function layerCount(page: Page) {
  return page.evaluate(() => (window as SodaWindow).__sodaViewer!.imageryLayers.length)
}

/** How far the tallest scrolling box of the sidebar overflows; 0 means nothing to scroll. */
async function sidebarOverflowPx(page: Page) {
  return page
    .getByTestId('tool-sidebar')
    .evaluate((sidebar) =>
      Math.max(
        0,
        ...[sidebar, ...sidebar.querySelectorAll('*')]
          .filter((element) => /auto|scroll/.test(getComputedStyle(element).overflowY))
          .map((element) => element.scrollHeight - element.clientHeight),
      ),
    )
}

// The coverage tool is hidden unless the build under test was made with the same flag.
test.skip(process.env.VITE_SODA_COVERAGE !== '1', 'coverage tool is hidden in this build')

test('coverage of an area is mapped, read by cell and exported', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await page.waitForFunction(() => Boolean((window as SodaWindow).__sodaViewer))
  await expect(page.locator('#boot')).toBeHidden()
  await expect(page.getByText(/CelesTrak ·/)).toBeVisible()
  await page.getByText('ISS', { exact: true }).click()
  await openTool(page, 'Imaging plan')
  await page.getByRole('button', { name: 'Go to propagation' }).click()
  await page.getByText('1 day', { exact: true }).click()
  await page.getByRole('button', { name: 'Propagate', exact: true }).click()
  await expect(page.getByRole('button', { name: /^ISS \(ZARYA\)/ })).toBeVisible()

  // Coverage has its own tool, which lists areas only. Without one the button waits and
  // says what it needs.
  await openTool(page, 'Coverage analysis')
  const panel = page.getByTestId('mission-coverage')
  await expect(panel.getByTestId('coverage-need-box')).toContainText('Add area')
  await expect(panel.getByTestId('coverage-compute')).toBeDisabled()
  await expect(panel.getByTestId('aoi-add-point')).toHaveCount(0)
  await expect(panel.getByTestId('pointing-chips')).toContainText('roll ±30°')
  await panel.getByTestId('aoi-type').click()
  await panel.getByTestId('aoi-form').getByRole('button', { name: 'Add', exact: true }).click()
  await expect(panel).toContainText('Areas (1)')
  await expect(panel.getByTestId('coverage-shape')).toHaveText(/^\d+ × \d+ cells$/)

  // The map is one more imagery layer, there only while it is showing.
  const before = await layerCount(page)
  await panel.getByTestId('coverage-compute').click()
  const stats = panel.getByTestId('coverage-stats')
  await expect(stats).toContainText('%')
  await expect.poll(() => layerCount(page)).toBe(before + 1)
  await expect(panel.getByTestId('coverage-legend')).toContainText('×')
  expect(await sidebarOverflowPx(page)).toBe(0)
  // Up close, where the cells can be told apart.
  await panel.getByRole('button', { name: 'Show on the globe' }).click()
  await page.waitForTimeout(4000)
  await page.screenshot({ path: `${SHOTS}/coverage-count-dark.png` })

  // Another metric repaints the same layer.
  await panel
    .getByTestId('coverage-metric')
    .getByRole('button', { name: 'Max gap', exact: true })
    .click()
  await expect(panel.getByTestId('coverage-legend')).not.toContainText('×')
  expect(await layerCount(page)).toBe(before + 1)

  // A click on the map reads one cell. Off the centre, where a ground station sits.
  const canvas = page.locator('.cesium-widget canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width / 2 + 70, box.y + box.height / 2 + 60)
  await expect(panel.getByTestId('coverage-cell')).toContainText('max')
  const selected = () =>
    page.evaluate(() =>
      Boolean((window as SodaWindow).__sodaViewer!.entities.getById('coverage-cell')),
    )
  await expect.poll(selected).toBe(true)

  const download = page.waitForEvent('download')
  await panel.getByTestId('coverage-csv').click()
  expect((await download).suggestedFilename()).toMatch(/^soda-coverage-\d+\.csv$/)

  // The same map drapes over the 2D map.
  await page.getByTestId('scene-mode').click()
  await page.waitForTimeout(2500)
  expect(await layerCount(page)).toBeGreaterThanOrEqual(before + 1)
  await page.screenshot({ path: `${SHOTS}/coverage-gap-2d-dark.png` })
  await page.getByTestId('scene-mode').click()

  // In another tool the globe has the layers it had before; the area made here is one of
  // the imaging targets there.
  await openTool(page, 'Imaging plan')
  await expect.poll(() => layerCount(page)).toBe(before)
  await expect.poll(selected).toBe(false)
  await expect(page.getByTestId('mission-access')).toContainText('Imaging targets (1/20)')
})
