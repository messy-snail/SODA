import { expect, test, type Page, type Route } from '@playwright/test'
import type { Cartographic, Viewer } from 'cesium'

type SodaWindow = Window & { __sodaViewer: Viewer }

const SHOTS = '../.cache/screenshots'
const ITEM = 'Japan-Earthquake-Jan-2024/53/120022100023/2024-01-02/10300100F316CD00'

/**
 * These tests never reach a real catalogue: the page's calls to SODA's own catalogue endpoints
 * are answered here, so nothing is downloaded and nothing is added to `data/imagery`.
 */
function candidate(changes: Record<string, unknown> = {}) {
  return {
    source: 'maxar',
    item_id: ITEM,
    title: 'Japan Earthquake Jan 2024 2024-01-02 0023',
    west_deg: 136.862,
    south_deg: 37.39,
    east_deg: 136.923,
    north_deg: 37.434,
    gsd_m: 0.53,
    acquired_at: '2024-01-02T01:57:51Z',
    license: 'CC BY-NC 4.0',
    attribution: 'Maxar Open Data Program',
    size_bytes: null,
    pixels: 303038464,
    clouds_percent: 0,
    importable: true,
    reason: null,
    ...changes,
  }
}

async function openImageryTab(page: Page) {
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('tab', { name: 'Imagery', exact: true }).click()
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

/** Show the page an empty library, whatever the server really holds. */
async function emptyLibrary(page: Page) {
  await page.route('**/api/v1/imagery', async (route: Route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: [] })
    else await route.fallback()
  })
}

/** Answer the import endpoint and collect what the page asked for. */
async function captureImports(page: Page) {
  const bodies: unknown[] = []
  await page.route('**/api/v1/imagery/catalog/import', async (route: Route) => {
    bodies.push(route.request().postDataJSON())
    await route.fulfill({ status: 202, json: { queued: [], skipped: [] } })
  })
  return bodies
}

test('the view is searched and the ticked results are imported by id', async ({ page }) => {
  const searches: string[] = []
  await page.route('**/api/v1/imagery/catalog/search*', async (route: Route) => {
    searches.push(route.request().url())
    await route.fulfill({
      json: {
        source: 'maxar',
        found: 4,
        truncated: false,
        results: [
          candidate(),
          candidate({
            item_id: `${ITEM}-B`,
            title: 'Second tile',
            gsd_m: null,
            clouds_percent: null,
          }),
          candidate({
            item_id: `${ITEM}-C`,
            title: 'Too large to take',
            importable: false,
            reason: 'tooLarge',
          }),
          candidate({
            item_id: `${ITEM}-D`,
            title: 'Day before',
            acquired_at: '2024-01-01T02:10:00Z',
          }),
        ],
      },
    })
  })
  const imports = await captureImports(page)
  // Otherwise a set really imported from this catalogue would show as already there.
  await emptyLibrary(page)
  await openImageryTab(page)
  // Adding waits folded under the list, and the catalogue is its second tab.
  await page.getByTestId('fold-imagery.add').click()
  await page.getByTestId('imagery-add-tab-catalog').click()

  // From the whole-Earth view there is no "this view" to search.
  const search = page.getByTestId('imagery-catalog-search')
  await expect(search).toBeDisabled()

  await lookFrom(page, 136.9, 37.41, 20_000)
  await expect(search).toBeEnabled()
  await search.click()

  const results = page.getByTestId('imagery-catalog-results')
  await expect(results).toContainText('Japan Earthquake Jan 2024 2024-01-02 0023')
  await expect(results).toContainText('resolution 0.53 m')
  await expect(results).toContainText('CC BY-NC 4.0')
  await expect(results).toContainText('Too large to import')
  // The search sent the box the globe is showing, around Wajima.
  const sent = new URL(searches[0]!).searchParams
  expect(sent.get('source')).toBe('maxar')
  expect(Number(sent.get('west_deg'))).toBeGreaterThan(136)
  expect(Number(sent.get('east_deg'))).toBeLessThan(138)
  expect(Number(sent.get('east_deg'))).toBeGreaterThan(Number(sent.get('west_deg')))

  // Results are sorted into acquisition dates; a chip narrows the list to one of them.
  const dates = page.getByTestId('imagery-catalog-dates')
  await expect(dates).toContainText('2024-01-02 · 3')
  await expect(dates).toContainText('2024-01-01 · 1')
  await dates.getByText('2024-01-01 · 1').click()
  await expect(results).toContainText('Day before')
  await expect(results).not.toContainText('Second tile')
  await dates.getByText('All', { exact: true }).click()
  await expect(results).toContainText('Second tile')
  // A date heading ticks everything of that date that can be imported.
  await page.getByLabel('Select all of 2024-01-01').check()
  await expect(page.getByLabel('Select Day before')).toBeChecked()
  await page.getByLabel('Select all of 2024-01-01').uncheck()
  await expect(page.getByLabel('Select Day before')).not.toBeChecked()

  const importButton = page.getByTestId('imagery-catalog-import')
  await expect(importButton).toBeDisabled()
  await expect(page.getByLabel('Select Too large to take')).toBeDisabled()
  await page.getByLabel('Select Japan Earthquake Jan 2024 2024-01-02 0023').check()
  await page.getByLabel('Select Second tile').check()
  await page.screenshot({ path: `${SHOTS}/imagery-catalog.png` })

  // A non-commercial licence is confirmed before anything is fetched.
  let asked = ''
  page.once('dialog', (dialog) => {
    asked = dialog.message()
    void dialog.accept()
  })
  await importButton.click()
  await expect.poll(() => imports.length).toBe(1)
  expect(asked).toContain('CC BY-NC 4.0')
  expect(imports[0]).toEqual({ source: 'maxar', item_ids: [ITEM, `${ITEM}-B`] })
})

/** A ready set as `GET /imagery` lists it. */
function imagerySet(changes: Record<string, unknown>) {
  return {
    id: 'u000000000001',
    name: 'My own scene',
    status: 'ready',
    source_format: 'geotiff',
    west_deg: 126.4,
    south_deg: 37.44,
    east_deg: 126.47,
    north_deg: 37.49,
    footprint: null,
    min_zoom: 12,
    max_zoom: 18,
    tile_format: 'mixed',
    tile_count: 1623,
    gsd_m: 12,
    size_bytes: 25374720,
    attribution: '',
    license: '',
    origin: null,
    acquired_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    sensor: null,
    label: null,
    sample: false,
    updated_at: '2026-10-01T00:00:00.000Z',
    stage: null,
    progress: null,
    error: null,
    ...changes,
  }
}

/** Answer the list and the samples state, whatever the server really holds. */
async function library(page: Page, sets: unknown[], samples: Record<string, unknown>) {
  await page.route('**/api/v1/imagery/samples', (route: Route) => route.fulfill({ json: samples }))
  await page.route('**/api/v1/imagery', async (route: Route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: sets })
    else await route.fallback()
  })
}

test('samples show what took them and cannot be edited or removed', async ({ page }) => {
  const radar = imagerySet({
    id: 'umbra-incheon-airport',
    name: 'Incheon Airport · Umbra SAR 0.9 m',
    label: { ko: '인천공항 · Umbra SAR 0.9 m', en: 'Incheon Airport · Umbra SAR 0.9 m' },
    sensor: 'sar',
    sample: true,
    gsd_m: 0.9,
    license: 'CC BY 4.0',
    attribution: 'Umbra Open Data Program',
  })
  const photo = imagerySet({
    id: 'maxar-wajima',
    name: 'Wajima, Japan · Maxar 0.5 m',
    label: { ko: '와지마 (일본) · Maxar 0.5 m', en: 'Wajima, Japan · Maxar 0.5 m' },
    sensor: 'optical',
    sample: true,
    gsd_m: 0.5,
    license: 'CC BY-NC 4.0',
  })
  await library(page, [imagerySet({}), radar, photo], { enabled: true, present: true, count: 2 })
  await openImageryTab(page)

  const radarRow = page.getByTestId('imagery-row-umbra-incheon-airport')
  const photoRow = page.getByTestId('imagery-row-maxar-wajima')
  const ownRow = page.getByTestId('imagery-row-u000000000001')

  // A row is one line: the name, what took the image, how sharp it is, and the way there.
  await expect(radarRow).toContainText('Incheon Airport · Umbra SAR 0.9 m')
  await expect(page.getByTestId('imagery-sensor-chip-umbra-incheon-airport')).toHaveText('SAR')
  await expect(page.getByTestId('imagery-sensor-chip-maxar-wajima')).toHaveText('EO')
  await expect(page.getByTestId('imagery-gsd-umbra-incheon-airport')).toHaveText('0.9 m')
  await expect(page.getByTestId('imagery-gsd-maxar-wajima')).toHaveText('0.5 m')
  await expect(page.getByTestId('imagery-fly-umbra-incheon-airport')).toBeVisible()
  await expect(radarRow).not.toContainText('GeoTIFF')
  const lineHeight = (await radarRow.boundingBox())!.height
  expect(lineHeight).toBeLessThan(44)
  // The two sensors are told apart by colour as well as by word.
  const tint = (id: string) =>
    page.getByTestId(`imagery-sensor-chip-${id}`).evaluate((chip) => getComputedStyle(chip).color)
  expect(await tint('umbra-incheon-airport')).not.toBe(await tint('maxar-wajima'))
  await page.screenshot({ path: `${SHOTS}/imagery-samples.png` })

  // Unfolded, a sample shows its details, and nothing that would change or remove it.
  await page.getByTestId('imagery-toggle-umbra-incheon-airport').click()
  await expect(radarRow).toContainText('Sample · GeoTIFF')
  await expect(radarRow).toContainText('CC BY 4.0')
  await expect(page.getByTestId('imagery-remove-umbra-incheon-airport')).toHaveCount(0)
  await expect(radarRow.getByRole('button', { name: /^Edit/ })).toHaveCount(0)
  await page.getByTestId('imagery-toggle-maxar-wajima').click()
  await expect(photoRow).toContainText('non-commercial use only')

  // The user's own set says nothing about its sensor until told, and keeps its buttons.
  await expect(page.getByTestId('imagery-sensor-chip-u000000000001')).toHaveCount(0)
  await page.getByTestId('imagery-toggle-u000000000001').click()
  await expect(page.getByTestId('imagery-remove-u000000000001')).toBeVisible()
  await ownRow.getByRole('button', { name: /^Edit/ }).click()
  await expect(ownRow.getByTestId('imagery-sensor-sar')).toBeVisible()
  await expect(page.getByTestId('imagery-samples-missing')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/imagery-samples-open.png` })

  // Filters narrow the list by sensor and by resolution.
  // The count sits in a disc of its own beside the word.
  await expect(page.getByTestId('imagery-filter-count-sar')).toHaveText('1')
  await expect(page.getByTestId('imagery-filter-count-optical')).toHaveText('1')
  await page.getByTestId('imagery-filter-sensor-sar').click()
  await expect(radarRow).toBeVisible()
  await expect(photoRow).toHaveCount(0)
  await expect(ownRow).toHaveCount(0)
  await page.getByTestId('imagery-filter-gsd-0.5').click()
  await expect(radarRow).toHaveCount(0)
  await page.getByTestId('imagery-filter-clear').click()
  await expect(page.getByTestId('imagery-list').locator('.imagery-row')).toHaveCount(3)
  await page.getByTestId('imagery-filter-gsd-0.5').click()
  await expect(photoRow).toBeVisible()
  await expect(radarRow).toHaveCount(0)

  // Adding waits folded under the list: a file of one's own, or a public catalogue.
  await expect(page.getByTestId('fold-imagery.add')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('imagery-form')).toBeHidden()
  await page.getByTestId('fold-imagery.add').click()
  await expect(page.getByTestId('imagery-form')).toBeVisible()
  await expect(page.getByTestId('imagery-catalog-search')).toHaveCount(0)
  await page.getByTestId('imagery-add-tab-catalog').click()
  await expect(page.getByTestId('imagery-catalog-search')).toBeVisible()
  await expect(page.getByTestId('imagery-form')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/imagery-add-catalog.png` })
})

test('without the submodule the card says how to get the samples', async ({ page }) => {
  await library(page, [], { enabled: true, present: false, count: 0 })
  await openImageryTab(page)
  const hint = page.getByTestId('imagery-samples-missing')
  await expect(hint).toContainText('git submodule update --init samples')

  // Switched off on the server, nothing is said about samples at all.
  await page.unroute('**/api/v1/imagery/samples')
  await page.route('**/api/v1/imagery/samples', (route: Route) =>
    route.fulfill({ json: { enabled: false, present: false, count: 0 } }),
  )
  await page.getByRole('button', { name: 'Reload', exact: true }).click()
  await expect(hint).toHaveCount(0)
})
