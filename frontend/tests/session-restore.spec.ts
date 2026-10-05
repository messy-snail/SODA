import { expect, test, type Page } from '@playwright/test'
import type { Cartographic, Viewer } from 'cesium'
import { openSatelliteStep } from './rail'

type SodaWindow = Window & { __sodaViewer: Viewer }

async function state(page: Page) {
  return page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    const carto = v.camera.positionCartographic
    return {
      lon: (carto.longitude * 180) / Math.PI,
      lat: (carto.latitude * 180) / Math.PI,
      heightKm: carto.height / 1000,
      seconds: v.clock.currentTime.secondsOfDay,
      playing: v.clock.shouldAnimate,
    }
  })
}

// `keep` opts this test into session storage, which other browser tests leave off.
test('a reload brings back the camera, clock, run and open panel', async ({ page }) => {
  await page.goto('/?e2e&keep&lang=en')
  await expect(page.locator('#boot')).toBeHidden()

  await page.getByText('ISS', { exact: true }).first().click()
  await page.getByTestId('to-propagate').click()
  await page.getByRole('button', { name: 'Propagate', exact: true }).click()
  await expect(page.locator('.run-list .list-row')).toHaveCount(1)

  // Pause part-way through the run and look at Europe from 5,000 km.
  await page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    v.clock.shouldAnimate = false
    // JulianDate is not global in the page; reach it through an instance.
    const JulianDate = v.clock.startTime.constructor as unknown as {
      addSeconds(date: unknown, seconds: number, result: unknown): typeof v.clock.currentTime
      new (): typeof v.clock.currentTime
    }
    v.clock.currentTime = JulianDate.addSeconds(v.clock.startTime, 1234, new JulianDate())
    const carto = { longitude: 0.2, latitude: 0.85, height: 5_000_000 } as Cartographic
    v.camera.setView({ destination: v.scene.globe.ellipsoid.cartographicToCartesian(carto) })
  })
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('tab', { name: 'Layers', exact: true }).click()
  await page.waitForTimeout(2500)
  const before = await state(page)

  await page.reload()
  await expect(page.locator('#boot')).toBeHidden()
  await expect(page.getByTestId('restore-notice')).toContainText('reloaded')
  await expect(page.locator('.run-list .list-row')).toHaveCount(0) // Layers panel, not runs
  await expect(page.getByRole('tab', { name: 'Layers', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByLabel('Tint countries')).toBeVisible()

  await expect
    .poll(async () => {
      const after = await state(page)
      return (
        Math.abs(after.lon - before.lon) < 0.01 &&
        Math.abs(after.lat - before.lat) < 0.01 &&
        Math.abs(after.heightKm - before.heightKm) < 1
      )
    })
    .toBe(true)
  const after = await state(page)
  expect(after.playing).toBe(false)
  expect(Math.abs(after.seconds - before.seconds)).toBeLessThan(3)

  await openSatelliteStep(page, 'runs')
  await expect(page.locator('.run-list .list-row')).toHaveCount(1)
})
