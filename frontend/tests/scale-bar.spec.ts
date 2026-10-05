import { expect, test, type Page } from '@playwright/test'
import type { Cartographic, Viewer } from 'cesium'

type SodaWindow = Window & { __sodaViewer: Viewer }

const SHOTS = '../.cache/screenshots'

/** Metres per pixel the bar claims: its ground length over its drawn width. */
async function shown(page: Page): Promise<number> {
  const bar = page.getByTestId('scale-bar')
  const length = Number(await bar.getAttribute('data-length-m'))
  const width = Number(await bar.getAttribute('data-width-px'))
  return length / width
}

/**
 * Metres per pixel measured on its own: two points 100 px apart across the middle of the
 * canvas, joined by a great circle on a sphere of the Earth's mean radius. The span matters
 * from far away, where the globe curves and a pixel covers more ground towards the limb.
 */
async function measured(page: Page): Promise<number> {
  return page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    const { clientWidth, clientHeight } = v.scene.canvas
    const ellipsoid = v.scene.globe.ellipsoid
    const at = (x: number) => {
      const hit = v.camera.pickEllipsoid({ x, y: clientHeight / 2 } as never, ellipsoid)
      return ellipsoid.cartesianToCartographic(hit!)
    }
    const a = at(clientWidth / 2 - 50)
    const b = at(clientWidth / 2 + 50)
    const h =
      Math.sin((b.latitude - a.latitude) / 2) ** 2 +
      Math.cos(a.latitude) * Math.cos(b.latitude) * Math.sin((b.longitude - a.longitude) / 2) ** 2
    return (2 * 6_371_000 * Math.asin(Math.sqrt(h))) / 100
  })
}

async function agrees(page: Page) {
  await expect
    .poll(async () => Math.abs((await shown(page)) / (await measured(page)) - 1))
    .toBeLessThan(0.02)
}

async function lookFrom(page: Page, lon: number, lat: number, height: number) {
  await page.evaluate(
    ([lonDeg, latDeg, h]) => {
      const v = (window as unknown as SodaWindow).__sodaViewer
      const carto = {
        longitude: (lonDeg! * Math.PI) / 180,
        latitude: (latDeg! * Math.PI) / 180,
        height: h!,
      } as Cartographic
      v.camera.setView({ destination: v.scene.globe.ellipsoid.cartographicToCartesian(carto) })
    },
    [lon, lat, height],
  )
}

test('the map scale follows the camera in 3D and on the 2D map', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()
  const bar = page.getByTestId('scale-bar')

  // The whole Earth from the home view: thousands of kilometres across the bar.
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('km')
  await agrees(page)
  // The scale is an HTML overlay; it must not cost an imagery layer.
  expect(
    await page.evaluate(() => (window as unknown as SodaWindow).__sodaViewer.imageryLayers.length),
  ).toBe(1)

  // Five kilometres above Seoul the bar is in metres.
  await lookFrom(page, 126.98, 37.57, 5000)
  await expect(bar).toContainText(/\d m$/)
  await agrees(page)
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${SHOTS}/scale-bar.png` })

  // Same measurement on the 2D map.
  await page.getByTestId('scene-mode').click()
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as SodaWindow).__sodaViewer.scene.mode as number),
      { timeout: 10_000 },
    )
    .toBe(2)
  await expect(bar).toBeVisible()
  await agrees(page)
  await page.keyboard.press('m')
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as SodaWindow).__sodaViewer.scene.mode as number),
      { timeout: 10_000 },
    )
    .toBe(3)

  // Looking away from the globe there is nothing to measure.
  await page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    v.camera.lookUp(Math.PI / 2)
  })
  await expect(bar).toHaveCount(0)

  // The switch in the layers tab takes it away for good.
  await page.getByTestId('home-view').click()
  await expect(bar).toBeVisible()
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('tab', { name: 'Layers', exact: true }).click()
  await page.getByLabel('Show the map scale').uncheck()
  await expect(bar).toHaveCount(0)
})
