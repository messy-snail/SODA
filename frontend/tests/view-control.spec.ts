import { expect, test, type Page } from '@playwright/test'
import type { Viewer } from 'cesium'
import { openSatelliteStep } from './rail'

type SodaWindow = Window & { __sodaViewer: Viewer }

const SHOTS = '../.cache/screenshots'

async function cameraState(page: Page) {
  return page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    const carto = v.camera.positionCartographic
    return {
      mode: v.scene.mode as number,
      lonDeg: (carto.longitude * 180) / Math.PI,
      latDeg: (carto.latitude * 180) / Math.PI,
    }
  })
}

test('home view centres Korea and the 2D map switch round-trips', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()

  // Move away, then come back home with the button.
  await page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    v.camera.rotateRight(1.2)
  })
  await page.getByTestId('home-view').click()
  await expect
    .poll(async () => {
      const state = await cameraState(page)
      return Math.abs(state.lonDeg - 127.8) < 0.5 && Math.abs(state.latDeg - 36.3) < 0.5
    })
    .toBe(true)
  await page.screenshot({ path: `${SHOTS}/view-home-3d.png` })

  // SceneMode.SCENE2D is 2 and SCENE3D is 3.
  await page.getByTestId('scene-mode').click()
  await expect.poll(async () => (await cameraState(page)).mode, { timeout: 10_000 }).toBe(2)
  await expect(page.getByTestId('scene-mode')).toContainText('3D')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOTS}/view-map-2d.png` })

  // The 2D map is Earth-fixed only.
  await openSatelliteStep(page, 'runs')
  await expect(page.getByRole('button', { name: 'Inertial (ECI)', exact: true })).toBeDisabled()

  await page.keyboard.press('m')
  await expect.poll(async () => (await cameraState(page)).mode, { timeout: 10_000 }).toBe(3)
  await expect(page.getByTestId('scene-mode')).toContainText('2D')
})
