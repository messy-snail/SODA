import { expect, test, type Page } from '@playwright/test'
import type { Viewer } from 'cesium'
import { openSatelliteStep } from './rail'

type SodaWindow = Window & { __sodaViewer: Viewer }

async function pose(page: Page) {
  return page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    const marker = v.entities.values.find((e) => e.id.startsWith('marker:'))
    const p = marker?.position?.getValue(v.clock.currentTime)
    return {
      camera: [v.camera.positionWC.x, v.camera.positionWC.y, v.camera.positionWC.z],
      direction: [v.camera.directionWC.x, v.camera.directionWC.y, v.camera.directionWC.z],
      marker: p ? [p.x, p.y, p.z] : [],
      transform: Array.from({ length: 16 }, (_, i) => v.camera.transform[i]),
    }
  })
}
function distance(a: number[], b: number[]) {
  return Math.hypot(...a.map((value, i) => value - b[i]!))
}
async function advance(page: Page) {
  await page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    v.clock.currentTime.secondsOfDay += 3600
  })
  await page.waitForTimeout(500)
}

test('replacement and Earth-fixed/inertial camera behavior', async ({ page }) => {
  await page.goto('/?e2e&lang=ko')
  await expect(page.locator('#boot')).toBeHidden()
  await page.getByText('ISS', { exact: true }).click()
  await page.getByTestId('to-propagate').click()
  await page.getByText('1일', { exact: true }).click()
  await page.getByRole('button', { name: '전파 실행' }).click()
  const rows = page.locator('.run-list .list-row')
  await expect(rows).toHaveCount(1)
  await page.getByTestId('satellite-step-propagate').click()
  await page.getByText('7일', { exact: true }).click()
  await page.getByRole('button', { name: '전파 실행' }).click()
  await expect(rows).toHaveAttribute('title', /20,161/)
  await expect(rows).toHaveCount(1)
  await page.evaluate(() => {
    ;(window as unknown as SodaWindow).__sodaViewer.clock.shouldAnimate = false
  })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as SodaWindow).__sodaViewer.entities.values.filter((e) =>
            e.id.startsWith('marker:'),
          ).length,
      ),
    )
    .toBe(1)
  const fixed = await pose(page)
  await advance(page)
  expect(distance(fixed.camera, (await pose(page)).camera)).toBeLessThan(0.01)

  const before = await pose(page)
  await page.getByRole('button', { name: '관성 (ECI)', exact: true }).click()
  await page.getByRole('button', { name: 'ECI로 전환', exact: true }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.locator('.frame-pill')).toContainText('ECI')
  await page.waitForTimeout(300)
  const inertial = await pose(page)
  // The inertial view rotates the camera itself; a look-at transform would disable collision.
  expect(inertial.transform).toEqual(before.transform)
  expect(distance(before.camera, inertial.camera)).toBeLessThan(0.01)
  expect(distance(before.direction, inertial.direction)).toBeLessThan(1e-8)
  expect(distance(before.marker, inertial.marker)).toBeLessThan(100)
  await advance(page)
  expect(distance(inertial.camera, (await pose(page)).camera)).toBeGreaterThan(1_000_000)
  await page.screenshot({ path: '../.cache/screenshots/reference-frame-eci.png' })

  await page.getByRole('button', { name: '따라가기', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(() => Boolean((window as unknown as SodaWindow).__sodaViewer.trackedEntity)),
    )
    .toBe(true)
  await page.getByRole('button', { name: '지구고정 (ECEF)', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(() => Boolean((window as unknown as SodaWindow).__sodaViewer.trackedEntity)),
    )
    .toBe(true)
  await page.getByRole('button', { name: '관성 (ECI)', exact: true }).click()
  await page.getByRole('button', { name: 'ECI로 전환', exact: true }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.getByRole('button', { name: '따라가기 해제', exact: true }).click()
  await page.waitForTimeout(500)
  const resumed = await pose(page)
  await advance(page)
  expect(distance(resumed.camera, (await pose(page)).camera)).toBeGreaterThan(1000)
  const beforeFixed = await pose(page)
  await page.getByRole('button', { name: '지구고정 (ECEF)', exact: true }).click()
  await page.waitForTimeout(300)
  expect(distance(beforeFixed.camera, (await pose(page)).camera)).toBeLessThan(0.01)
  await page.screenshot({ path: '../.cache/screenshots/reference-frame-ecef.png' })
})

test('frame chip switches between ECEF and ECI', async ({ page }) => {
  await page.goto('/?e2e&lang=ko')
  await expect(page.locator('#boot')).toBeHidden()
  const chip = page.getByTestId('frame-pill')
  await expect(chip).toContainText('ECEF')
  await chip.click()
  // Going inertial asks first, from the dialog shared with the runs card.
  await page.getByRole('button', { name: '취소', exact: true }).click()
  await expect(chip).toContainText('ECEF')
  await chip.click()
  await page.getByRole('button', { name: 'ECI로 전환', exact: true }).click()
  await expect(chip).toContainText('ECI')
  await chip.click()
  await expect(chip).toContainText('ECEF')
  await page.getByTestId('scene-mode').click()
  await expect(chip).toBeDisabled()
})

test('failed inertial preload falls back to ECEF', async ({ page }) => {
  await page.route('**/IAU2006_XYS/**', (route) => route.abort())
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'runs')
  await page.getByRole('button', { name: 'Inertial (ECI)', exact: true }).click()
  await page.getByRole('button', { name: 'Switch to ECI', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Returned to ECEF')
  await expect(
    page.getByRole('button', { name: 'Earth-fixed (ECEF)', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.unroute('**/IAU2006_XYS/**')
  await page.getByRole('button', { name: 'Inertial (ECI)', exact: true }).click()
  await page.getByRole('button', { name: 'Switch to ECI', exact: true }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Inertial (ECI)', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('inertial view keeps the camera above the surface while zooming in', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'runs')
  await page.getByRole('button', { name: 'Inertial (ECI)', exact: true }).click()
  await page.getByRole('button', { name: 'Switch to ECI', exact: true }).click()
  await expect(page.locator('.frame-pill')).toContainText('ECI')
  const globe = page.locator('.globe canvas')
  const box = (await globe.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 80; i++) {
    await page.mouse.wheel(0, -1200)
    await page.waitForTimeout(40)
  }
  await page.waitForTimeout(800)
  const height = await page.evaluate(
    () => (window as unknown as SodaWindow).__sodaViewer.camera.positionCartographic.height,
  )
  expect(height).toBeGreaterThan(0)
  await page.screenshot({ path: '../.cache/screenshots/reference-frame-eci-zoom.png' })
})
