import { deflateSync } from 'node:zlib'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { Viewer } from 'cesium'

type SodaWindow = Window & { __sodaViewer: Viewer }

const SHOTS = '../.cache/screenshots'
const FIXTURES = 'tests/fixtures/imagery'
/** Every set these tests create carries this prefix, so a failed run can be cleaned up. */
const PREFIX = 'e2e-'
const UPLOAD_NAME = `${PREFIX}quad`
/** A tilted footprint over Incheon, about 70 km across; top-left, clockwise. */
const INCHEON = [126.37, 37.67, 127.04, 37.55, 126.88, 37.02, 126.21, 37.15]
/** A footprint a few kilometres across, east of Daejeon. */
const SMALL = [127.5, 36.35, 127.55, 36.35, 127.55, 36.3, 127.5, 36.3]

interface Listed {
  id: string
  name: string
  status: string
}

async function listed(request: APIRequestContext): Promise<Listed[]> {
  const list = (await (await request.get('/api/v1/imagery')).json()) as Listed[]
  return list.filter((item) => item.name.startsWith(PREFIX))
}

async function cleanUp(request: APIRequestContext) {
  for (const item of await listed(request)) await request.delete(`/api/v1/imagery/${item.id}`)
}

/** Register an image with its corners through the API and wait until it has been cut. */
async function register(request: APIRequestContext, name: string, corners: number[]) {
  const query = new URLSearchParams({
    source_format: 'image',
    name,
    corners_deg: corners.join(','),
  })
  const created = await request.post(`/api/v1/imagery?${query}`, {
    data: quadrantPng(),
    headers: { 'Content-Type': 'application/octet-stream' },
  })
  expect(created.status()).toBe(202)
  const { id } = (await created.json()) as Listed
  await expect
    .poll(async () => (await listed(request)).find((item) => item.id === id)?.status)
    .toBe('ready')
  return id
}

async function openImageryTab(page: Page) {
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('tab', { name: 'Imagery', exact: true }).click()
}

/** East-west span of each imagery layer in degrees, bottom layer first. */
async function layerSpans(page: Page) {
  return page.evaluate(() => {
    const layers = (window as unknown as SodaWindow).__sodaViewer.imageryLayers
    return Array.from({ length: layers.length }, (_, i) => {
      const rectangle = layers.get(i).imageryProvider?.rectangle
      return rectangle ? Math.round(((rectangle.east - rectangle.west) * 180) / Math.PI) : null
    })
  })
}

async function imageryCount(page: Page) {
  return page.evaluate(() => (window as unknown as SodaWindow).__sodaViewer.imageryLayers.length)
}

async function cameraNear(page: Page, lon: number, lat: number, tolerance = 0.5) {
  await expect
    .poll(async () => {
      const state = await page.evaluate(() => {
        const carto = (window as unknown as SodaWindow).__sodaViewer.camera.positionCartographic
        return [(carto.longitude * 180) / Math.PI, (carto.latitude * 180) / Math.PI]
      })
      return Math.abs(state[0]! - lon) < tolerance && Math.abs(state[1]! - lat) < tolerance
    })
    .toBe(true)
}

/** Wait until the globe has nothing left to load, so a screenshot shows the finished tiles. */
async function tilesLoaded(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as SodaWindow).__sodaViewer.scene.globe.tilesLoaded),
    )
    .toBe(true)
  await page.waitForTimeout(1500)
}

function crc32(bytes: Buffer): number {
  let crc = ~0
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

/** A square PNG split into four coloured quadrants, built without an image library. */
function quadrantPng(size = 64): Buffer {
  const chunk = (kind: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(kind, 'ascii'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const rows = Buffer.alloc(size * (1 + size * 4))
  const colours = [
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 255],
    [0, 0, 255],
  ]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const colour = colours[(y < size / 2 ? 0 : 2) + (x < size / 2 ? 0 : 1)]!
      rows.set([...colour, 255], y * (1 + size * 4) + 1 + x * 4)
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

test.afterEach(async ({ request }) => cleanUp(request))

test('zooming in on a set shows it between the basemap and the country overlay', async ({
  page,
  request,
}) => {
  const id = await register(request, `${PREFIX}incheon`, INCHEON)
  await openImageryTab(page)
  // Seen from far away the globe holds the basemap alone, whatever is registered.
  await expect(page.getByTestId(`imagery-row-${id}`)).toBeVisible()
  expect(await imageryCount(page)).toBe(1)

  // Going there is all it takes: no switch per set.
  await page.getByTestId(`imagery-fly-${id}`).click()
  await cameraNear(page, 126.63, 37.35)
  await expect.poll(() => imageryCount(page)).toBe(2)
  await expect(page.getByTestId(`imagery-showing-${id}`)).toBeVisible()

  // The country overlay is added afterwards and still lands above the imagery.
  await page.getByRole('tab', { name: 'Layers', exact: true }).click()
  await page.getByLabel('Show country borders').check()
  await expect.poll(() => imageryCount(page)).toBe(3)
  const spans = await layerSpans(page)
  expect(spans[1]).toBeLessThan(2)
  expect(spans[2]).toBe(360)
  await page.getByRole('tab', { name: 'Imagery', exact: true }).click()

  // Half opacity lets the basemap show through, which is how alignment is judged.
  await page.getByTestId(`imagery-toggle-${id}`).click()
  const thumb = page.getByTestId(`imagery-opacity-${id}`).getByRole('slider')
  await thumb.focus()
  for (let step = 0; step < 10; step++) await thumb.press('ArrowLeft')
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as SodaWindow).__sodaViewer.imageryLayers.get(1).alpha,
      ),
    )
    .toBeCloseTo(0.5, 2)
  await tilesLoaded(page)
  await page.screenshot({ path: `${SHOTS}/imagery-set-half.png` })

  // The one switch turns the whole feature off, and back on.
  await page.getByTestId('imagery-auto').locator('input').uncheck()
  await expect.poll(() => imageryCount(page)).toBe(2)
  await expect(page.getByTestId(`imagery-showing-${id}`)).toHaveCount(0)
  await page.getByTestId('imagery-auto').locator('input').check()
  await expect.poll(() => imageryCount(page)).toBe(3)

  // Zooming back out takes the imagery away again.
  await page.getByTestId('home-view').click()
  await expect.poll(() => imageryCount(page)).toBe(2)
})

test('going to a set only a few kilometres across still shows it', async ({ page, request }) => {
  const id = await register(request, `${PREFIX}small`, SMALL)
  await openImageryTab(page)
  expect(await imageryCount(page)).toBe(1)
  await page.getByTestId(`imagery-fly-${id}`).click()
  await cameraNear(page, 127.525, 36.325, 0.05)
  await expect.poll(() => imageryCount(page)).toBe(2)
  await expect(page.getByTestId(`imagery-showing-${id}`)).toBeVisible()
  await tilesLoaded(page)
  await page.screenshot({ path: `${SHOTS}/imagery-small.png` })
})

test('an image with its corners is imported, shown and deleted', async ({ page, request }) => {
  await openImageryTab(page)
  // Adding waits folded under the list; unfolding it shows the form.
  await page.getByTestId('fold-imagery.add').click()
  await page.getByTestId('imagery-file').setInputFiles({
    name: `${UPLOAD_NAME}.png`,
    mimeType: 'image/png',
    buffer: quadrantPng(),
  })
  // The file decides the format: a PNG switches the form to the image fields.
  await expect(page.getByTestId('imagery-format-image')).toHaveClass(/v-btn--active/)
  await expect(page.getByTestId('imagery-name').locator('input')).toHaveValue(UPLOAD_NAME)
  await expect(page.getByTestId('imagery-submit')).toBeDisabled()
  // A catalogue footprint pasted as it comes: a closed WKT ring over Jeju.
  await page
    .getByTestId('imagery-corners')
    .locator('textarea')
    .first()
    .fill('POLYGON ((126.1 33.6, 127.0 33.7, 127.1 33.2, 126.2 33.1, 126.1 33.6))')
  await page.getByTestId('imagery-submit').click()

  // Once cut, the camera goes to the set, and being there is what shows it.
  await expect.poll(async () => (await listed(request))[0]?.status).toBe('ready')
  const id = (await listed(request))[0]!.id
  await cameraNear(page, 126.6, 33.4)
  await expect.poll(() => imageryCount(page)).toBe(2)
  await expect(page.getByTestId(`imagery-showing-${id}`)).toBeVisible()
  await tilesLoaded(page)
  await page.screenshot({ path: `${SHOTS}/imagery-upload.png` })

  // Deleting lives in the row's details, one click away from the list.
  await page.getByTestId(`imagery-toggle-${id}`).click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByTestId(`imagery-remove-${id}`).click()
  await expect(page.getByTestId(`imagery-row-${id}`)).toHaveCount(0)
  await expect.poll(() => imageryCount(page)).toBe(1)
  expect(await listed(request)).toEqual([])
})

test('several georeferenced files are registered in one go', async ({ page, request }) => {
  await openImageryTab(page)
  // Adding waits folded under the list; unfolding it shows the form.
  await page.getByTestId('fold-imagery.add').click()
  await page
    .getByTestId('imagery-file')
    .setInputFiles([`${FIXTURES}/e2e-a.tif`, `${FIXTURES}/e2e-b.tif`])

  // Two files open the batch form instead of filling the single one.
  const batch = page.getByTestId('imagery-batch')
  await expect(batch).toContainText('e2e-a.tif')
  await expect(batch).toContainText('e2e-b.tif')
  await page.screenshot({ path: `${SHOTS}/imagery-batch.png` })
  await page.getByTestId('imagery-batch-submit').click()

  await expect
    .poll(async () => (await listed(request)).map((item) => `${item.name}:${item.status}`).sort())
    .toEqual(['e2e-a:ready', 'e2e-b:ready'])
  // A clean batch closes its form, and does not send the camera after each file.
  await expect(batch).toHaveCount(0)
  expect(await imageryCount(page)).toBe(1)
  for (const item of await listed(request)) {
    await expect(page.getByTestId(`imagery-row-${item.id}`)).toBeVisible()
  }
})
