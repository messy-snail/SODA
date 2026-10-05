import { expect, test, type Page } from '@playwright/test'
import type { PolylineCollection, Viewer } from 'cesium'

type SodaWindow = Window & { __sodaViewer: Viewer }

/** What the comparison layer is drawing right now, read straight off the scene. */
type DashState = { count: number; show: boolean; material: string; runId: string | null }

const SHOTS = '../.cache/screenshots'

function dashState(page: Page): Promise<DashState> {
  return page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    for (let i = 0; i < v.scene.primitives.length; i++) {
      const c = v.scene.primitives.get(i) as PolylineCollection
      if (!c.length || typeof c.get !== 'function') continue
      const id = c.get(0).id as { kind?: string; runId?: string } | undefined
      if (id?.kind !== 'inertial-reference') continue
      return {
        count: c.length,
        show: c.show,
        material: c.get(0).material.type as string,
        runId: id.runId ?? null,
      }
    }
    return { count: 0, show: false, material: '', runId: null }
  })
}

/** The solid ground track, which must stay Earth-fixed while the dashed path is drawn. */
function orbitState(page: Page) {
  return page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    for (let i = 0; i < v.scene.primitives.length; i++) {
      const c = v.scene.primitives.get(i) as PolylineCollection
      if (c.length && typeof c.get === 'function' && c.get(0).id?.kind === 'orbit')
        return {
          material: c.get(0).material.type as string,
          model: Array.from({ length: 16 }, (_, k) => c.modelMatrix[k]),
        }
    }
    return null
  })
}

/**
 * A canvas pixel that sits on the solid orbit line, preferring one the dashed comparison path
 * covers. Clicking there is the regression test for the dashed path swallowing orbit clicks.
 */
function orbitPixel(page: Page) {
  return page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    let orbit: PolylineCollection | null = null
    for (let i = 0; i < v.scene.primitives.length; i++) {
      const c = v.scene.primitives.get(i) as PolylineCollection
      if (c.length && typeof c.get === 'function' && c.get(0).id?.kind === 'orbit') orbit = c
    }
    if (!orbit) return null
    // The line is cut where the element-age grade changes and at each eclipse edge.
    const positions = Array.from({ length: orbit.length }, (_, k) => orbit!.get(k).positions).flat()
    const { clientWidth, clientHeight } = v.scene.canvas
    let fallback: { x: number; y: number; covered: boolean } | null = null
    // Skip the first samples: the clock sits at the start, so seeking there would not move it.
    for (let k = 26; k < positions.length; k += 13) {
      const win = v.scene.cartesianToCanvasCoordinates(positions[k]!)
      if (!win || win.x < 4 || win.y < 4 || win.x > clientWidth - 4 || win.y > clientHeight - 4)
        continue
      // A panel over the globe (the side bar, the dock) takes the click.
      const box = v.scene.canvas.getBoundingClientRect()
      if (document.elementFromPoint(box.left + win.x, box.top + win.y) !== v.scene.canvas) continue
      const top = v.scene.pick(win)?.id as { kind?: string } | undefined
      if (top?.kind === 'inertial-reference') return { x: win.x, y: win.y, covered: true }
      if (top?.kind === 'orbit' && !fallback) fallback = { x: win.x, y: win.y, covered: false }
    }
    return fallback
  })
}

/** Frame the propagated satellite so both paths are comparable in the screenshot. */
async function lookAtSatellite(page: Page, height: number) {
  await page.evaluate((h) => {
    const viewer = (window as unknown as SodaWindow).__sodaViewer
    const marker = viewer.entities.values.find((e) => e.id.startsWith('marker:'))!
    const position = marker.position!.getValue(viewer.clock.currentTime)!
    const ellipsoid = viewer.scene.globe.ellipsoid
    const carto = ellipsoid.cartesianToCartographic(position)
    carto.height = h
    viewer.camera.setView({ destination: ellipsoid.cartographicToCartesian(carto) })
  }, height)
}

function seconds(page: Page) {
  return page.evaluate(
    () => (window as unknown as SodaWindow).__sodaViewer.clock.currentTime.secondsOfDay,
  )
}

test('the comparison path only draws in ECI and never blocks the orbit line', async ({ page }) => {
  await page.goto('/?e2e&lang=ko', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#boot')).toBeHidden()
  await page.getByText('ISS', { exact: true }).first().click()
  await page.getByTestId('to-propagate').click()
  await page.getByRole('button', { name: '전파 실행' }).click()
  await expect(page.locator('.run-list .list-row')).toHaveCount(1)

  // ECEF: the corner chip reads ECEF and nothing dashed is drawn.
  await expect(page.locator('.frame-pill')).toHaveText('ECEF')
  expect((await dashState(page)).show).toBe(false)

  await page.getByRole('button', { name: '관성 (ECI)' }).click()
  await page.getByRole('button', { name: 'ECI로 전환' }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.locator('.frame-pill')).toHaveText('ECI')
  await expect.poll(async () => (await dashState(page)).count).toBeGreaterThan(0)

  const dashed = await dashState(page)
  expect(dashed.show).toBe(true)
  expect(dashed.material).toBe('PolylineDash')

  // The solid path stays Earth-fixed geometry; only the camera moved.
  const solid = await orbitState(page)
  expect(solid?.material).toBe('Color')
  expect(solid?.model).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

  // The legend names the satellite it compares and explains both lines.
  await expect(page.locator('.frame-compare')).toContainText('ISS')
  await expect(page.locator('.frame-compare')).toContainText('실선')
  await expect(page.locator('.frame-compare')).toContainText('점선')
  await lookAtSatellite(page, 4_000_000)
  await page.waitForTimeout(6000)
  await page.screenshot({ path: `${SHOTS}/comparison-eci-ko.png` })

  // Clicking the orbit still seeks, even where the dashed path lies on top of it.
  await page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    v.clock.shouldAnimate = false
    v.clock.currentTime = v.clock.startTime.clone()
  })
  await page.waitForTimeout(400)
  const pixel = await orbitPixel(page)
  expect(pixel, 'no orbit pixel was reachable on screen').not.toBeNull()
  const before = await seconds(page)
  const canvas = (await page.locator('canvas').first().boundingBox())!
  await page.mouse.click(canvas.x + pixel!.x, canvas.y + pixel!.y)
  await expect.poll(() => seconds(page)).not.toBe(before)

  // Turning the comparison off clears the dashed path; turning it back on restores it.
  await page.getByLabel('우주 기준 궤도 비교').click()
  await expect.poll(async () => (await dashState(page)).show).toBe(false)
  await page.getByLabel('우주 기준 궤도 비교').click()
  await expect.poll(async () => (await dashState(page)).show).toBe(true)

  // Hiding the target run hides the comparison and says why. The tool rail toggles, so the
  // propagation panel must not be clicked again here - it is already open.
  await expect(page.locator('.run-list .list-row')).toHaveCount(1)
  await page.getByRole('button', { name: '숨기기', exact: true }).click()
  await expect.poll(async () => (await dashState(page)).show).toBe(false)
  await expect(page.locator('.frame-compare')).toContainText('숨김')
  await page.getByRole('button', { name: '보이기', exact: true }).click()
  await expect.poll(async () => (await dashState(page)).show).toBe(true)

  // At the end of the propagation interval there is no future revolution left to draw.
  await page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    v.clock.currentTime = v.clock.stopTime.clone()
  })
  await expect.poll(async () => (await dashState(page)).show).toBe(false)

  // Invalid-sample gaps are covered by src/globe/referencePath.test.ts; a propagation that
  // produces them cannot be arranged from the UI.
})

test('the badge and legend read correctly in English', async ({ page }) => {
  await page.goto('/?e2e&lang=en', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#boot')).toBeHidden()
  await page.getByText('ISS', { exact: true }).first().click()
  await page.getByTestId('to-propagate').click()
  await page.getByRole('button', { name: 'Propagate', exact: true }).click()
  await expect(page.locator('.run-list .list-row')).toHaveCount(1)

  await page.getByRole('button', { name: 'Inertial (ECI)' }).click()
  await page.getByRole('button', { name: 'Switch to ECI' }).click()
  await expect(page.getByRole('status')).toHaveCount(0)

  await expect(page.locator('.frame-pill')).toHaveText('ECI')
  await expect(page.locator('.frame-compare')).toContainText('Solid')
  await expect(page.locator('.frame-compare')).toContainText('Dashed')
  await expect(page.locator('.frame-compare')).not.toHaveText(/[ㄱ-ㆎ가-힣]/)
  await expect.poll(async () => (await dashState(page)).count).toBeGreaterThan(0)
  await lookAtSatellite(page, 4_000_000)
  await page.waitForTimeout(6000)
  await page.screenshot({ path: `${SHOTS}/comparison-eci-en.png` })
})
