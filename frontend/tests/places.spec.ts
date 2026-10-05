import { expect, test, type Page } from '@playwright/test'
import type { Cartographic, Viewer } from 'cesium'

type SodaWindow = Window & { __sodaViewer: Viewer }

const SHOTS = '../.cache/screenshots'

async function camera(page: Page) {
  return page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    const carto = v.camera.positionCartographic
    return {
      lon: (carto.longitude * 180) / Math.PI,
      lat: (carto.latitude * 180) / Math.PI,
      heightKm: carto.height / 1000,
    }
  })
}

async function cameraNear(page: Page, lon: number, lat: number, tolerance = 1) {
  await expect
    .poll(async () => {
      const state = await camera(page)
      return Math.abs(state.lon - lon) < tolerance && Math.abs(state.lat - lat) < tolerance
    })
    .toBe(true)
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

async function imageryCount(page: Page) {
  return page.evaluate(() => (window as unknown as SodaWindow).__sodaViewer.imageryLayers.length)
}

async function labelCount(page: Page) {
  return page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    let most = 0
    for (let i = 0; i < v.scene.primitives.length; i++) {
      const p = v.scene.primitives.get(i) as {
        length?: number
        get?: (i: number) => { text?: unknown }
      }
      if (p.length && typeof p.get === 'function' && typeof p.get(0).text === 'string') {
        most = Math.max(most, p.length)
      }
    }
    return most
  })
}

async function hasDraftRing(page: Page) {
  return page.evaluate(
    () => !!(window as unknown as SodaWindow).__sodaViewer.entities.getById('pin-draft'),
  )
}

async function pinEntities(page: Page) {
  return page.evaluate(() =>
    (window as unknown as SodaWindow).__sodaViewer.entities.values
      .filter((entity) => entity.id.startsWith('pin:'))
      .map((entity) => ({ name: entity.name, billboard: !!entity.billboard })),
  )
}

test('country tint, place search, pins and the home view', async ({ page }) => {
  // Cesium reports a crashed render loop through console.error, not a page error.
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Rendering has stopped')) {
      errors.push(message.text())
    }
  })
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()

  // The tint and outlines are one imagery overlay above the basemap, and survive a swap.
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('tab', { name: 'Layers', exact: true }).click()
  expect(await imageryCount(page)).toBe(1)
  await page.getByLabel('Tint countries').check()
  await page.getByLabel('Show country borders').check()
  await page.getByLabel('Show country names').check()
  await expect.poll(() => imageryCount(page)).toBe(2)
  await expect.poll(() => labelCount(page)).toBeGreaterThan(200)
  await page.getByLabel('Basemap').click({ force: true })
  await page
    .getByRole('option', { name: /Imagery/ })
    .first()
    .click()
  await expect.poll(() => imageryCount(page)).toBe(2)
  // Facing the Pacific, the countries on the far side must not show through.
  await lookFrom(page, -160, 10, 18_000_000)
  await page.waitForTimeout(4000)
  await page.screenshot({ path: `${SHOTS}/places-tint-pacific.png` })
  await page.getByLabel('Tint countries').uncheck()
  await page.getByLabel('Show country borders').uncheck()
  await expect.poll(() => imageryCount(page)).toBe(1)
  await page.getByLabel('Tint countries').check()

  // Search a country, fly there, and pin it.
  await page.getByRole('tab', { name: 'Places', exact: true }).click()
  const search = page.getByTestId('place-search').locator('input')
  await search.fill('south korea')
  await expect(page.getByTestId('place-hit').first()).toContainText('South Korea')
  await search.press('Enter')
  await cameraNear(page, 127.9, 36.5, 3)
  // The pin button only proposes the spot: a ring marks it and the pin form takes its name.
  await page.getByTestId('place-hit').first().getByTestId('place-pin').click()
  await expect.poll(() => hasDraftRing(page)).toBe(true)
  await expect(page.getByTestId('pin-name').locator('input')).toHaveValue('South Korea')
  expect(await pinEntities(page)).toHaveLength(0)
  await page.getByTestId('pin-add').click()
  await expect(page.getByTestId('pin-list')).toContainText('South Korea')
  await expect.poll(() => hasDraftRing(page)).toBe(false)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOTS}/places-korea-tint.png` })

  // Coordinates are recognised in the same box; pinning them names the pin after the place.
  await search.fill('36.35N 127.38E')
  await expect(page.getByTestId('place-coordinate')).toContainText('36.3500°N 127.3800°E')
  await page.getByTestId('place-coordinate').getByTestId('place-pin').click()
  await expect(page.getByTestId('pin-lat').locator('input')).toHaveValue('36.35')
  await page.getByTestId('pin-add').click()
  await expect(page.getByTestId('pin-list')).toContainText('Daejeon')

  // A pin and a search result copy into the imaging targets: the pin as a point, a country
  // as the box of its extent. The button stays lit once the target exists.
  const aoiKinds = () =>
    page.evaluate(() =>
      (window as unknown as SodaWindow).__sodaViewer.entities.values
        .filter((entity) => entity.id.startsWith('aoi:'))
        .map((entity) => (entity.rectangle ? 'box' : 'point')),
    )
  const daejeon = page.getByTestId('pin-list').locator('.pin-entry', { hasText: 'Daejeon' })
  await expect(daejeon.getByTestId('pin-to-target')).toHaveAttribute('aria-pressed', 'false')
  await daejeon.getByTestId('pin-to-target').click()
  await expect(daejeon.getByTestId('pin-to-target')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(aoiKinds).toEqual(['point'])
  await search.fill('south korea')
  const korea = page.getByTestId('place-hit').first()
  await korea.getByTestId('place-target').click()
  await expect(korea.getByTestId('place-target')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(aoiKinds).toEqual(['point', 'box'])
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/places-to-target.png` })
  // A second click does not add it again; it opens the target in the imaging tool.
  await korea.getByTestId('place-target').click()
  await expect(page.getByTestId('aoi-list')).toContainText('South Korea')
  await expect(page.getByTestId('aoi-list')).toContainText('Daejeon')
  expect(await aoiKinds()).toEqual(['point', 'box'])
  // Back the other way: the area target saved as a pin, and a pin picked from the menu.
  const areaRow = page.getByTestId('aoi-list').locator('.list-row', { hasText: 'South Korea' })
  await areaRow.getByTestId('aoi-to-pin').click()
  await expect(areaRow.getByTestId('aoi-to-pin')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('aoi-from-pins').click()
  const options = page.getByTestId('aoi-pin-option')
  await expect(options).toHaveCount(3)
  // Daejeon is a target already; the country pin (at its label point) is not.
  await expect(options.filter({ hasText: 'Daejeon' })).toBeDisabled()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SHOTS}/mission-from-pins.png` })
  await options.filter({ hasText: 'South Korea' }).first().click()
  await expect(page.getByTestId('mission-access')).toContainText('Imaging targets (3/20)')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'View', exact: true }).click()
  const entries = page.getByTestId('pin-list').locator('.pin-entry')
  await expect(entries).toHaveCount(3)
  // The copy is a pin like any other; deleting it leaves the target alone.
  await entries.last().getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(entries).toHaveCount(2)
  expect(await aoiKinds()).toHaveLength(3)

  // Typed coordinates are shown first; typing others drops the ring.
  await page.getByTestId('pin-lat').locator('input').fill('35.1')
  await page.getByTestId('pin-lon').locator('input').fill('129.04')
  await page.getByTestId('pin-preview').click()
  await expect.poll(() => hasDraftRing(page)).toBe(true)
  await page.getByTestId('pin-lon').locator('input').fill('129.5')
  await expect.poll(() => hasDraftRing(page)).toBe(false)

  // Pick on the globe: the click fills the form, and an empty name gets a default.
  await page.getByTestId('pin-placing').click()
  const box = (await page.locator('.globe canvas').boundingBox())!
  await page.mouse.click(box.x + box.width / 2 + 150, box.y + box.height / 2)
  await expect
    .poll(async () => page.getByTestId('pin-lat').locator('input').inputValue())
    .not.toBe('35.1')
  await page.getByTestId('pin-icon-rocket').click()
  await page.getByTestId('pin-color-2').click()
  await page.getByTestId('pin-add').click()
  await expect(page.getByTestId('pin-list').locator('.pin-entry')).toHaveCount(3)
  await expect.poll(async () => (await pinEntities(page)).length).toBe(3)
  await expect.poll(async () => (await pinEntities(page)).every((pin) => pin.billboard)).toBe(true)
  // Each pin also has a small badge that takes over from the name tag when zoomed out.
  expect(
    await page.evaluate(
      () =>
        (window as unknown as SodaWindow).__sodaViewer.entities.values.filter((e) =>
          e.id.startsWith('pin-far:'),
        ).length,
    ),
  ).toBe(3)

  // Edit a pin's name and icon, hide it, and show it again.
  const first = page.getByTestId('pin-list').locator('.pin-entry').first()
  await first.getByTestId('pin-edit').click()
  await first.getByTestId('pin-edit-name').locator('input').fill('Korea')
  await first.getByTestId('pin-icon-star').click()
  await expect(first.locator('.row-main')).toContainText('Korea')
  await first.getByTestId('pin-visible').click()
  await expect.poll(async () => (await pinEntities(page)).length).toBe(2)
  await first.getByTestId('pin-visible').click()
  await expect.poll(async () => (await pinEntities(page)).length).toBe(3)

  // A pin from the current view flies back to it.
  await page.getByTestId('pin-name').locator('input').fill('Here')
  await page.getByTestId('pin-add-view').click()
  await expect(page.getByTestId('pin-list')).toContainText('Here')
  const here = await camera(page)
  await lookFrom(page, 0, 0, 20_000_000)
  await page.getByTestId('pin-list').locator('.pin-entry').last().getByTestId('pin-go').click()
  await cameraNear(page, here.lon, here.lat)

  // A new home view is where H returns to.
  await page.getByTestId('home-lat').locator('input').fill('48.85')
  await page.getByTestId('home-lon').locator('input').fill('2.35')
  await page.getByTestId('home-height').locator('input').fill('3000')
  await page.getByTestId('home-apply').click()
  await cameraNear(page, 2.35, 48.85)
  await lookFrom(page, 0, 0, 20_000_000)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('h')
  await cameraNear(page, 2.35, 48.85)
  expect((await camera(page)).heightKm).toBeCloseTo(3000, -2)

  await lookFrom(page, 127.5, 36, 2_500_000)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${SHOTS}/places-pins.png` })
  expect(errors).toEqual([])
})
