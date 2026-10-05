import { expect, test, type Page } from '@playwright/test'
import type { Color, PolylineCollection, Viewer } from 'cesium'
import { openTool } from './rail'

type SodaWindow = Window & { __sodaViewer: Viewer }

const SHOTS = '../.cache/screenshots'

function imageryCount(page: Page) {
  return page.evaluate(() => (window as unknown as SodaWindow).__sodaViewer.imageryLayers.length)
}

/** Pause the clock `seconds` after the start of the propagated range. */
async function seekTo(page: Page, seconds: number) {
  await page.evaluate((offset) => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    v.clock.shouldAnimate = false
    const time = v.clock.startTime.clone()
    time.secondsOfDay += offset
    v.clock.currentTime = time
  }, seconds)
}

/** Brightness of each piece of the orbit line, in drawing order. */
function lineBrightness(page: Page) {
  return page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    for (let i = 0; i < v.scene.primitives.length; i++) {
      const c = v.scene.primitives.get(i) as PolylineCollection
      if (!c.length || typeof c.get !== 'function' || c.get(0).id?.kind !== 'orbit') continue
      return Array.from({ length: c.length }, (_, k) => {
        const color = c.get(k).material.uniforms.color as Color
        return Math.max(color.red, color.green, color.blue)
      })
    }
    return []
  })
}

test('eclipses dim the orbit line, mark the clock bar and shade the 2D map', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()
  await page.getByText('ISS', { exact: true }).click()
  await page.getByTestId('to-propagate').click()
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/propagate') && r.ok()),
    page.getByRole('button', { name: 'Propagate', exact: true }).click(),
  ])
  const { eclipse_s } = (await response.json()) as { eclipse_s: number[] }
  expect(eclipse_s.length).toBeGreaterThanOrEqual(4)
  // The second eclipse lies wholly inside the range, whatever the first one is clipped to.
  const [enter, leave] = [eclipse_s[2]!, eclipse_s[3]!]

  // The line alternates between the run colour and its dimmed version.
  await expect.poll(async () => (await lineBrightness(page)).length).toBeGreaterThan(2)
  const brightness = await lineBrightness(page)
  expect(Math.min(...brightness)).toBeLessThan(0.6 * Math.max(...brightness))

  // In eclipse: the chip shows, and the clock bar carries the eclipse bands.
  const baseLayers = await imageryCount(page)
  await seekTo(page, (enter + leave) / 2)
  await expect(page.getByTestId('eclipse-chip')).toBeVisible()
  // The clock starts as a dock icon; pin it so its slider stays in the screenshots.
  await page.getByTestId('tray-clock').hover()
  await page.locator('.timeline').getByTestId('clock-pin').click()
  await page.mouse.move(800, 300)
  const bands = await page
    .getByTestId('clock-slider')
    .evaluate((slider) => getComputedStyle(slider).getPropertyValue('--eclipse-bands'))
  expect(bands).toContain('linear-gradient')
  await page.screenshot({ path: `${SHOTS}/eclipse-3d.png` })
  // The 3D globe keeps Cesium's lighting; the shading is a 2D layer.
  expect(await imageryCount(page)).toBe(baseLayers)

  // SceneMode.SCENE2D is 2. The night side and the shadow are one imagery layer.
  await page.getByTestId('scene-mode').click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as SodaWindow).__sodaViewer.scene.mode), {
      timeout: 10_000,
    })
    .toBe(2)
  await expect.poll(() => imageryCount(page)).toBe(baseLayers + 1)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${SHOTS}/eclipse-map-2d.png` })

  // At the moment of entry the satellite sits on the edge of the shaded area.
  await seekTo(page, enter)
  await page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    const marker = v.entities.values.find((e) => e.id.startsWith('marker:'))!
    const carto = v.scene.globe.ellipsoid.cartesianToCartographic(
      marker.position!.getValue(v.clock.currentTime)!,
    )
    carto.height = 6_000_000
    v.camera.setView({ destination: v.scene.globe.ellipsoid.cartographicToCartesian(carto) })
  })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${SHOTS}/eclipse-map-2d-entry.png` })

  // Out of eclipse the chip goes, and the layer is repainted in place rather than replaced.
  await seekTo(page, leave + 600)
  await expect(page.getByTestId('eclipse-chip')).toBeHidden()
  await page.waitForTimeout(1500)
  expect(await imageryCount(page)).toBe(baseLayers + 1)
  await page.screenshot({ path: `${SHOTS}/eclipse-map-2d-sunlit.png` })

  // Each switch removes its part; with both off the layer is gone and the line is one colour.
  await openTool(page, 'View')
  await page.getByRole('tab', { name: 'Layers', exact: true }).click()
  await page.getByLabel('Show eclipses').uncheck()
  await expect.poll(() => imageryCount(page)).toBe(baseLayers + 1)
  const plain = await lineBrightness(page)
  expect(Math.min(...plain)).toBe(Math.max(...plain))
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${SHOTS}/eclipse-map-2d-night-only.png` })
  await page.getByLabel('Day and night lighting').uncheck()
  await expect.poll(() => imageryCount(page)).toBe(baseLayers)
  await page.getByLabel('Day and night lighting').check()
  await page.getByLabel('Show eclipses').check()
  await expect.poll(() => imageryCount(page)).toBe(baseLayers + 1)
})
