import { expect, test, type Page } from '@playwright/test'
import type { Viewer } from 'cesium'
import { openSatelliteStep, openTool } from './rail'

const SHOTS = '../.cache/screenshots'

type SodaWindow = Window & { __sodaViewer?: Viewer }

async function aoiEntities(page: Page) {
  return page.evaluate(() =>
    (window as SodaWindow)
      .__sodaViewer!.entities.values.filter((entity) => entity.id.startsWith('aoi:'))
      .map((entity) => ({ point: !!entity.point, rectangle: !!entity.rectangle })),
  )
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

test('imaging targets, opportunities and jumping to the best time', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await page.waitForFunction(() => Boolean((window as SodaWindow).__sodaViewer))
  await expect(page.locator('#boot')).toBeHidden()
  await expect(page.getByText(/CelesTrak ·/)).toBeVisible()

  await page.getByText('ISS', { exact: true }).click()
  await expect(page.getByTestId('satellite-basket')).toContainText('ISS (ZARYA)')

  // Without a propagated run there is nothing to search yet.
  await openTool(page, 'Imaging plan')
  const panel = page.getByTestId('mission-access')
  await expect(panel.getByTestId('access-compute')).toBeDisabled()
  await panel.getByRole('button', { name: 'Go to propagation' }).click()
  await page.getByText('1 day', { exact: true }).click()
  await page.getByRole('button', { name: 'Propagate', exact: true }).click()
  await expect(page.getByRole('button', { name: /^ISS \(ZARYA\)/ })).toBeVisible()

  await openTool(page, 'Imaging plan')
  await expect(panel.getByTestId('access-run')).toContainText('ISS (ZARYA)')

  // One point and one area from the coordinate form (its defaults are Daejeon and Korea).
  await panel.getByTestId('aoi-type').click()
  await panel.getByTestId('aoi-form').getByRole('button', { name: 'Add', exact: true }).click()
  await panel.getByTestId('aoi-type').click()
  const form = panel.getByTestId('aoi-form')
  await form.getByRole('button', { name: 'Area', exact: true }).click()
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(panel).toContainText('Imaging targets (2/20)')
  await expect
    .poll(() => aoiEntities(page))
    .toEqual([
      { point: true, rectangle: false },
      { point: false, rectangle: true },
    ])

  // An area can also be clicked out on the globe: two corners.
  await panel.getByTestId('aoi-add-box').click()
  await expect(panel.getByTestId('aoi-placing')).toContainText('first corner')
  const canvas = page.locator('.cesium-widget canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45)
  await expect(panel.getByTestId('aoi-placing')).toContainText('opposite corner')
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5)
  await expect(panel).toContainText('Imaging targets (3/20)')

  // The targets fit the panel; the opportunities wait on their own tab until a search.
  const targetsTab = page.getByTestId('imaging-tab-targets')
  const resultsTab = page.getByTestId('imaging-tab-results')
  await expect(resultsTab).toHaveText('Opportunities')
  await resultsTab.click()
  await expect(panel.getByTestId('access-empty')).toBeVisible()
  await panel.getByRole('button', { name: 'Go to targets' }).click()
  expect(await sidebarOverflowPx(page)).toBe(0)

  // A search that answers turns the panel to what it found.
  await panel.getByTestId('access-compute').click()
  await expect(panel.getByTestId('access-summary')).toContainText('ISS (ZARYA)')
  await expect(resultsTab).toHaveText(/Opportunities \(\d+\)/)
  await expect(panel.getByTestId('access-compute')).toHaveCount(0)
  const rows = panel.getByTestId('access-row')
  await expect(rows.first()).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/mission-access-dark.png` })
  // Every target says what the search found for it, or why it found nothing.
  await targetsTab.click()
  await expect(panel.getByTestId('access-reason')).toHaveCount(3)
  await expect(panel.getByTestId('access-reason').first()).toHaveText(
    /found|too dark|Out of roll reach|No pass/,
  )
  await page.screenshot({ path: `${SHOTS}/mission-access-targets-dark.png` })
  await resultsTab.click()

  // Every result lies inside the run, so jumping there keeps the playback range and the
  // satellite stays drawn.
  const clockState = () =>
    page.evaluate(() => {
      const viewer = (window as SodaWindow).__sodaViewer!
      const now = viewer.clock.currentTime
      const marker = viewer.entities.values.find((entity) => entity.id.startsWith('marker:'))
      return {
        time: now.toString(),
        clamped: viewer.clock.clockRange === 1,
        drawn: !!marker?.position?.getValue(now),
      }
    })
  const before = await clockState()
  await rows.first().click()
  await expect.poll(async () => (await clockState()).time).not.toBe(before.time)
  expect(await clockState()).toMatchObject({ clamped: true, drawn: true })

  // Strips and imaged orbit stretches are on the globe; at the best time the sensor's
  // line of sight to the target is drawn.
  const accessGraphics = () =>
    page.evaluate(() => {
      const viewer = (window as SodaWindow).__sodaViewer!
      const all = viewer.entities.values
      // One line of sight per satellite: ``access-sight:<satellite>``.
      const sight = all.find((e) => e.id.startsWith('access-sight:'))
      const line = sight?.polyline?.positions?.getValue(viewer.clock.currentTime) as
        unknown[] | undefined
      return {
        strips: all.filter((e) => e.id.startsWith('access:')).length,
        tracks: all.filter((e) => e.id.startsWith('access-track:')).length,
        sight: line?.length ?? 0,
      }
    })
  await page.evaluate(() => ((window as SodaWindow).__sodaViewer!.clock.shouldAnimate = false))
  await rows.first().click()
  await expect.poll(accessGraphics).toMatchObject({ sight: 2 })
  const graphics = await accessGraphics()
  expect(graphics.strips).toBeGreaterThan(0)
  expect(graphics.tracks).toBe(graphics.strips)
  await page.screenshot({ path: `${SHOTS}/mission-access-strip-dark.png` })

  // Roll only (the default): a point is one instant. Roll + pitch gives it a window.
  // The limits open beside the panel from the gear; the panel names the ones in force.
  const pointRow = rows.filter({ hasText: 'P1' }).first()
  if (await pointRow.count()) await expect(pointRow).toContainText('instant')
  await targetsTab.click()
  await expect(panel.getByTestId('pointing-chips')).toHaveText(/Roll only\s*roll ±30°/)
  await page.getByTestId('imaging-options-open').click()
  const pointing = page.getByTestId('access-pointing')
  await expect(pointing.getByTestId('pointing-explain')).toContainText('passes abeam')
  await pointing.getByTestId('pointing-roll-pitch').click()
  await expect(pointing.getByLabel('Max pitch (°)')).toBeVisible()
  await expect(panel.getByTestId('pointing-chips')).toContainText('Roll + pitch')
  // The stale result says so on its own tab, and can be searched again from there.
  await resultsTab.click()
  await expect(panel.getByTestId('access-stale')).toContainText('compute again')
  await panel.getByTestId('access-recompute').click()
  await expect(panel.getByTestId('access-stale')).toHaveCount(0)
  await expect(rows.first()).toContainText('Pitch')

  // The swath sensor fills in the roll limit and FOV. Clicking in the panel closed the
  // options, so they are opened again first.
  await expect(pointing).toBeHidden()
  await page.getByTestId('imaging-options-open').click()
  await pointing.getByTestId('access-import-sensor').click()
  await expect(pointing.getByTestId('access-fov').locator('input')).not.toHaveValue('0')
  await page.screenshot({ path: `${SHOTS}/mission-access-options-dark.png` })
})

test('passes of two runs share a station by priority', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await page.waitForFunction(() => Boolean((window as SodaWindow).__sodaViewer))
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'pick')
  const sidebar = page.getByTestId('tool-sidebar')
  await sidebar.getByTestId('pick-norad:25544').click()
  // Suggestions give way to history once something is picked, so the second one is searched.
  await sidebar.getByTestId('satellite-query').locator('input').fill('NOAA 20')
  await sidebar.getByTestId('satellite-row-norad:43013').click()
  await expect(sidebar.getByTestId('satellite-basket')).toContainText('NOAA 20')
  await sidebar.getByTestId('to-propagate').click()
  await page.getByText('1 day', { exact: true }).click()
  await page.getByRole('button', { name: 'Propagate', exact: true }).click()
  await expect(page.getByTestId('satellite-step-runs')).toContainText('2')

  // A run charts its altitude and its beta angle over the whole span.
  await sidebar.getByTestId('run-series').first().click()
  const series = page.getByTestId('run-series-dialog')
  await expect(series.getByTestId('run-series-stats')).toContainText('km')
  await series.getByRole('button', { name: 'Beta angle' }).click()
  await expect(series.getByTestId('run-series-stats')).toContainText('°')
  await expect(series.getByTestId('run-series-empty')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/run-series-dark.png` })
  await series.getByRole('button', { name: 'Close' }).click()
  await expect(series).toHaveCount(0)

  // One pass prediction covers both runs.
  await openTool(page, 'Pass prediction')
  const panel = sidebar
  await expect(panel.getByTestId('pass-satellite')).toHaveCount(2)
  await panel.getByRole('button', { name: 'Predict passes' }).click()
  await expect(panel).toContainText('assigned')
  const rows = panel.locator('.pass-row')
  await expect(rows.first()).toBeVisible()
  await expect(rows.filter({ hasText: 'NOAA 20' }).first()).toBeVisible()
  await expect(rows.filter({ hasText: 'ISS (ZARYA)' }).first()).toBeVisible()
  const drawn = (prefix: string) =>
    page.evaluate(
      (p) =>
        (window as SodaWindow).__sodaViewer!.entities.values.filter((e) => e.id.startsWith(p))
          .length,
      prefix,
    )
  await expect.poll(() => drawn('pass:')).toBeGreaterThan(0)
  await expect.poll(() => drawn('pass-sight:')).toBeGreaterThan(0)
  await page.screenshot({ path: `${SHOTS}/passes-two-satellites-dark.png` })

  // Reordering the priority makes the result stale until it is predicted again.
  const first = await panel.getByTestId('pass-satellite').first().textContent()
  await panel.getByRole('button', { name: 'Lower priority' }).first().click()
  await expect(panel.getByTestId('pass-satellite').nth(1)).toContainText(first!.slice(2, 10))
  await expect(panel.getByTestId('passes-stale')).toBeVisible()
  await panel.getByRole('button', { name: 'Predict passes' }).click()
  await expect(panel.getByTestId('passes-stale')).toHaveCount(0)

  const download = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'CSV' }).click()
  expect((await download).suggestedFilename()).toMatch(/^soda-passes-\d+\.csv$/)

  // A pass opens its sky plot and curves without asking the server anything.
  await rows.first().getByTestId('pass-detail').click()
  const detail = page.getByTestId('pass-detail-dialog')
  const skyPoints = async () =>
    ((await detail.getByTestId('sky-track').getAttribute('points')) ?? '').split(' ').length
  expect(await skyPoints()).toBeGreaterThan(3)
  await expect(detail.getByTestId('pass-detail-stats')).toContainText('kHz')
  await detail.getByRole('button', { name: 'Range rate' }).click()
  await expect(detail.getByTestId('pass-detail-scale')).toContainText('km/s')
  await expect(detail.getByRole('button', { name: 'Range rate' })).toHaveClass(/v-btn--active/)
  await detail.getByTestId('pass-detail-stats').hover()
  await page.screenshot({ path: `${SHOTS}/pass-detail-dark.png` })
  await detail.getByRole('button', { name: 'Close' }).click()
  await expect(detail).toHaveCount(0)

  // A click lands on the pass's AOS by default, or on its peak once switched.
  const clockMs = () =>
    page.evaluate(() => {
      const viewer = (window as SodaWindow).__sodaViewer!
      return Date.parse(viewer.clock.currentTime.toString())
    })
  const labelMs = async (row: ReturnType<typeof rows.first>) => {
    const label = (await row.getAttribute('aria-label')) ?? ''
    const match = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC/.exec(label)
    return Date.parse(`${match![1]}T${match![2]}Z`)
  }
  await page.evaluate(() => ((window as SodaWindow).__sodaViewer!.clock.shouldAnimate = false))
  const firstRow = rows.first()
  const aosMs = await labelMs(firstRow)
  await firstRow.click()
  expect(Math.abs((await clockMs()) - aosMs)).toBeLessThan(3000)
  await panel.getByTestId('contact-jump').getByRole('button', { name: 'Jump to peak' }).click()
  const tcaMs = await labelMs(firstRow)
  expect(tcaMs).toBeGreaterThan(aosMs)
  await firstRow.click()
  expect(Math.abs((await clockMs()) - tcaMs)).toBeLessThan(3000)

  // A pass of either run is reachable without losing the playback range.
  await rows.last().click()
  const clamped = await page.evaluate(
    () => (window as SodaWindow).__sodaViewer!.clock.clockRange === 1,
  )
  expect(clamped).toBe(true)
})

test('imaging covers every propagated satellite, each in its own colour', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await page.waitForFunction(() => Boolean((window as SodaWindow).__sodaViewer))
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'pick')
  const sidebar = page.getByTestId('tool-sidebar')
  await sidebar.getByTestId('pick-norad:25544').click()
  await sidebar.getByTestId('satellite-query').locator('input').fill('NOAA 20')
  await sidebar.getByTestId('satellite-row-norad:43013').click()
  await sidebar.getByTestId('to-propagate').click()
  await page.getByText('1 day', { exact: true }).click()
  await page.getByRole('button', { name: 'Propagate', exact: true }).click()
  await expect(page.getByTestId('satellite-step-runs')).toContainText('2')

  // Both satellites are named before the search and in its summary.
  await openTool(page, 'Imaging plan')
  const access = page.getByTestId('mission-access')
  await expect(access.getByTestId('access-run')).toContainText('ISS (ZARYA)')
  await expect(access.getByTestId('access-run')).toContainText('NOAA 20')
  await access.getByTestId('aoi-type').click()
  const form = access.getByTestId('aoi-form')
  await form.getByRole('button', { name: 'Area', exact: true }).click()
  await form.getByLabel('West longitude (°)').fill('100')
  await form.getByLabel('East longitude (°)').fill('150')
  await form.getByLabel('South latitude (°)').fill('-10')
  await form.getByLabel('North latitude (°)').fill('45')
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await access.getByTestId('access-compute').click()
  const rows = access.getByTestId('access-row')
  await expect(rows.first()).toBeVisible()
  const summary = access.getByTestId('access-summary')
  await expect(summary.getByTestId('access-filter')).toHaveCount(2)
  await expect(rows.filter({ hasText: 'ISS (ZARYA)' }).first()).toBeVisible()
  await expect(rows.filter({ hasText: 'NOAA 20' }).first()).toBeVisible()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/mission-access-multi-dark.png` })

  // Strips are told apart by satellite on the globe as well.
  const strips = await page.evaluate(() => {
    const all = (window as SodaWindow).__sodaViewer!.entities.values
    const of = (slug: string) => all.filter((e) => e.id.startsWith(`access:${slug}:`))
    const css = (entity: (typeof all)[number] | undefined) =>
      entity?.polygon?.outlineColor?.getValue()?.toCssColorString() ?? ''
    const iss = of('norad-25544')
    const noaa = of('norad-43013')
    return { iss: iss.length, noaa: noaa.length, issColor: css(iss[0]), noaaColor: css(noaa[0]) }
  })
  expect(strips.iss).toBeGreaterThan(0)
  expect(strips.noaa).toBeGreaterThan(0)
  expect(strips.issColor).not.toBe(strips.noaaColor)

  // A chip narrows the list to one satellite; the same chip brings the rest back.
  const all = await rows.count()
  const noaaChip = summary.getByTestId('access-filter').filter({ hasText: 'NOAA 20' })
  await noaaChip.click()
  await expect(rows.filter({ hasText: 'ISS (ZARYA)' })).toHaveCount(0)
  expect(await rows.count()).toBeLessThan(all)
  await noaaChip.click()
  await expect(rows).toHaveCount(all)

  // Storage is one satellite's: the picker says which, and choosing the other changes it.
  await openTool(page, 'Onboard storage')
  const storage = page.getByTestId('mission-storage')
  const picker = storage.getByTestId('target-run-select')
  await expect(picker).toContainText('ISS (ZARYA)')
  await expect(picker).toContainText(`${strips.iss} acquisitions`)
  await picker.click()
  await page.getByRole('option', { name: /NOAA 20/ }).click()
  await expect(picker).toContainText('NOAA 20')
  await expect(page.getByTestId('selection-chip')).toContainText('NOAA 20')
  await expect(picker).toContainText(`${strips.noaa} acquisitions`)
})

test('storage and battery follow the imaging plan and the planned contacts', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await page.waitForFunction(() => Boolean((window as SodaWindow).__sodaViewer))
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'pick')
  await page.getByTestId('tool-sidebar').getByTestId('pick-norad:25544').click()
  await page.getByTestId('to-propagate').click()
  await page.getByText('1 day', { exact: true }).click()
  await page.getByRole('button', { name: 'Propagate', exact: true }).click()
  await expect(page.getByTestId('satellite-step-runs')).toContainText('1')

  await openTool(page, 'Onboard storage')
  await expect(page.getByTestId('mission-storage')).toContainText('imaging opportunities first')

  // Imaging over a wide area and a pass prediction for the same run.
  await openTool(page, 'Imaging plan')
  const access = page.getByTestId('mission-access')
  await access.getByTestId('aoi-type').click()
  const form = access.getByTestId('aoi-form')
  await form.getByRole('button', { name: 'Area', exact: true }).click()
  await form.getByLabel('West longitude (°)').fill('100')
  await form.getByLabel('East longitude (°)').fill('150')
  await form.getByLabel('South latitude (°)').fill('-10')
  await form.getByLabel('North latitude (°)').fill('45')
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await access.getByTestId('access-compute').click()
  await expect(access.getByTestId('access-row').first()).toBeVisible()
  await openTool(page, 'Pass prediction')
  await page.getByRole('button', { name: 'Predict passes' }).click()
  await expect(page.locator('.pass-row').first()).toBeVisible()

  await openTool(page, 'Onboard storage')
  const storage = page.getByTestId('mission-storage')
  await expect(storage.getByTestId('storage-chart')).toBeVisible()
  await expect(storage.getByTestId('storage-no-plan')).toHaveCount(0)
  // The tool names the satellite it works on, in a picker that can change it.
  await expect(storage.getByTestId('target-run-select')).toContainText('ISS (ZARYA)')
  const stat = (name: string) =>
    storage.getByTestId('storage-stats').locator('.stat', { hasText: name }).locator('strong')
  await expect(stat('Imaged')).not.toHaveText('0.00')
  await expect(stat('Downlinked')).not.toHaveText('0.00')
  // The settings open beside the panel. The area is wide, so a sweep across it is a large
  // image: with room for all of them nothing is lost and nothing is tinted.
  const lost = storage.getByTestId('storage-lost')
  const storageForm = page.getByTestId('storage-settings')
  await page.getByTestId('storage-settings-open').click()
  await storageForm.getByLabel('Capacity (Gbit)').fill('50000')
  await expect(lost.locator('strong')).toHaveText('0')
  await expect(storage.locator('.stat[data-level="error"]')).toHaveCount(0)
  // A station switched off takes nothing down.
  const station = storageForm.getByTestId('storage-station').first()
  await station.getByRole('button', { name: 'Off', exact: true }).click()
  await expect(stat('Downlinked')).toHaveText('0.00')
  // S-band is slower than X-band, so less comes down through the same contacts.
  await station.getByRole('button', { name: 'X', exact: true }).click()
  await expect(stat('Downlinked')).not.toHaveText('0.00')
  const overX = await stat('Downlinked').innerText()
  await station.getByRole('button', { name: 'S', exact: true }).click()
  await expect
    .poll(async () => Number(await stat('Downlinked').innerText()))
    .toBeLessThan(Number(overX))
  await station.getByRole('button', { name: 'X', exact: true }).click()
  await expect(stat('Downlinked')).toHaveText(overX)
  await page.screenshot({ path: `${SHOTS}/mission-storage-settings-dark.png` })
  await page.keyboard.press('Escape')
  await expect(storageForm).toBeHidden()

  // The lists are folded, so nothing scrolls; the assumptions sit behind the info icon.
  expect(await sidebarOverflowPx(page)).toBe(0)
  await page.getByTestId('storage-about').hover()
  await expect(page.getByText('Each imaging window is one image file')).toBeVisible()
  // Every window is an image of its own; unticking one takes it off the recorder.
  const imaged = await stat('Imaged').innerText()
  await storage.getByTestId('fold-storage.images').click()
  const firstImage = storage.getByTestId('storage-image').first().locator('input')
  await firstImage.uncheck()
  await expect(stat('Imaged')).not.toHaveText(imaged)
  await firstImage.check()
  await expect(stat('Imaged')).toHaveText(imaged)
  await storage.getByTestId('fold-storage.images').click()
  // Each contact shows what it sent against what it could carry.
  await storage.getByTestId('fold-storage.passes').click()
  await expect(storage.getByTestId('storage-pass').first()).toContainText('usable')
  await page.screenshot({ path: `${SHOTS}/mission-storage-passes-dark.png` })
  await storage.getByTestId('fold-storage.passes').click()

  // An image that does not fit is not stored, and the tile says so.
  await page.getByTestId('storage-settings-open').click()
  await storageForm.getByLabel('Capacity (Gbit)').fill('5')
  await expect(lost).toHaveAttribute('data-level', 'error')
  await page.keyboard.press('Escape')
  await expect(storageForm).toBeHidden()
  await page.screenshot({ path: `${SHOTS}/mission-storage-dark.png` })

  // The same acquisitions and contacts load the battery, on top of the eclipse cycle.
  await openTool(page, 'Power budget')
  const power = page.getByTestId('mission-power')
  await expect(power.getByTestId('power-chart')).toBeVisible()
  await expect(power).toContainText(/[1-9]\d* acquisitions · [1-9]\d* contacts/)
  await expect(power.getByTestId('target-run-select')).toContainText('ISS (ZARYA)')
  await expect(power.getByTestId('power-notices')).toHaveCount(0)
  const lowest = power
    .getByTestId('power-stats')
    .locator('.stat', { hasText: 'Lowest SOC' })
    .locator('strong')
  await expect(lowest).not.toHaveText('100.0')
  await expect(power.getByTestId('power-empty')).toHaveCount(0)
  // The starting state of charge applies at the run's start until another time is given.
  const socAt = power.getByTestId('power-soc-at').locator('input')
  // The browser drops `:00` seconds from the value, so the later time carries some.
  const runStart = await socAt.inputValue()
  expect(runStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)
  const runStartMs = Date.parse(`${runStart.length === 16 ? `${runStart}:00` : runStart}Z`)
  const later = new Date(runStartMs + 6 * 3600_000 + 7000).toISOString().slice(0, 19)
  const generated = power
    .getByTestId('power-stats')
    .locator('.stat', { hasText: 'Generated' })
    .locator('strong')
  const wholeRun = await generated.innerText()
  await socAt.fill(later)
  await expect(socAt).toHaveValue(later)
  // Less of the run is left to simulate, so less is generated.
  await expect(generated).not.toHaveText(wholeRun)
  await expect(lowest).not.toHaveText('100.0')
  await expect(power.locator('.v-alert.text-error')).toHaveCount(0)
  expect(await sidebarOverflowPx(page)).toBe(0)
  // What the model assumes sits behind the info icon, not in the panel.
  await page.getByTestId('power-about').hover()
  await expect(page.getByText('Only the umbra counts as eclipse')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/mission-power-dark.png` })
  // Nothing is tinted while the budget holds.
  const depth = power.getByTestId('power-stats').locator('.stat', { hasText: 'Lowest SOC' })
  await expect(power.locator('.stat[data-level]')).toHaveCount(0)
  // The settings open beside the panel from the gear, so the chart stays in view.
  await page.getByTestId('power-settings-open').click()
  const powerForm = page.getByTestId('power-settings')
  await powerForm.getByLabel('Base (W)').fill('5000')
  await expect(depth).toHaveAttribute('data-level', 'error')
  expect(await sidebarOverflowPx(page)).toBe(0)
  await page.screenshot({ path: `${SHOTS}/mission-power-settings-dark.png` })
  await expect(power.getByTestId('power-empty')).toBeVisible()
  await expect(lowest).toHaveText('0.0')

  // The equivalent circuit adds a voltage and a current to draw, on the same one chart.
  await powerForm.getByLabel('Base (W)').fill('400')
  await expect(power.getByTestId('power-series')).toHaveCount(0)
  await powerForm.getByRole('button', { name: 'Equivalent circuit', exact: true }).click()
  await expect(powerForm.getByLabel('Series cells')).toHaveValue('8')
  // The panel names what is chosen, since the form is out of sight most of the time.
  await expect(power.getByTestId('power-chips')).toHaveText(/Sun-pointing\s*Equivalent circuit/)
  const seriesPicker = power.getByTestId('power-series')
  await expect(seriesPicker).toBeVisible()
  await expect(power.locator('.stat[data-level]')).toHaveCount(0)
  await seriesPicker.getByRole('button', { name: 'Voltage', exact: true }).click()
  await expect(power.getByTestId('power-range')).toContainText(/Lowest \d+\.\d+ V/)
  expect(await sidebarOverflowPx(page)).toBe(0)
  await page.screenshot({ path: `${SHOTS}/mission-power-circuit-dark.png` })

  // The curve is typed in a dialog; a falling voltage cannot be applied. Clicking in the
  // panel closed the settings, so they are opened again first.
  await expect(powerForm).toBeHidden()
  await page.getByTestId('power-settings-open').click()
  await powerForm.getByTestId('power-curve-open').click()
  const curve = page.getByTestId('ocv-curve')
  const curveText = curve.getByTestId('ocv-curve-text').locator('textarea').first()
  await expect(curveText).toHaveValue(/^0, 3\n5, 3\.3/)
  // Let the dialog finish fading in before the picture.
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/mission-power-curve-dark.png` })
  await curveText.fill('0, 3.4\n100, 3.2')
  await expect(curve.getByTestId('ocv-curve-apply')).toBeDisabled()
  await curveText.fill('0, 3.2\n50, 3.7\n100, 4.1')
  await curve.getByTestId('ocv-curve-apply').click()
  await expect(curve).toBeHidden()
  await expect(power.getByTestId('power-range')).toContainText('highest')
  await seriesPicker.getByRole('button', { name: 'Current', exact: true }).click()
  await expect(power.getByTestId('power-range')).toContainText('resistive loss')
})

test('simulated TC/TM link waits for a contact, then plays back and uplinks', async ({ page }) => {
  // The server keeps one session for every tab; start from none.
  await page.request.delete('/api/v1/tmtc/session')
  await page.goto('/?e2e&lang=en')
  await page.waitForFunction(() => Boolean((window as SodaWindow).__sodaViewer))
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'pick')
  await page.getByTestId('tool-sidebar').getByTestId('pick-norad:25544').click()
  await page.getByTestId('to-propagate').click()
  await page.getByText('1 day', { exact: true }).click()
  await page.getByRole('button', { name: 'Propagate', exact: true }).click()
  await expect(page.getByTestId('satellite-step-runs')).toContainText('1')

  await openTool(page, 'TC/TM link')
  const panel = page.getByTestId('mission-tmtc')
  await panel.getByTestId('tmtc-start').click()
  await expect(panel.getByTestId('tmtc-link')).toBeVisible()
  // Outside the panel, the chip shows the session waiting for its next contact.
  const chip = page.getByTestId('tmtc-chip')
  await expect(chip).toContainText('Next AOS in')
  // The contact it waits for is on the globe as a band with its AOS and LOS pinned.
  const focusIds = () =>
    page.evaluate(() =>
      (window as SodaWindow)
        .__sodaViewer!.entities.values.map((entity) => entity.id)
        .filter((id) => id.startsWith('tmtc-pass')),
    )
  expect(await focusIds()).toHaveLength(3)

  // Out of contact at the start of the run: the command waits on the ground.
  await panel.getByTestId('tmtc-send').click()
  await expect(panel.getByTestId('tmtc-log')).toContainText('waiting for the next AOS')
  await expect(chip).toContainText('1 TC waiting')

  // The panel jumps to the contact itself; the chip and the globe follow.
  await panel.getByTestId('tmtc-next-aos').click()
  await expect(panel.getByTestId('tmtc-link')).toContainText('Open')
  await expect(chip).toContainText('Link open')
  await expect(chip).toContainText('TC↑ 1')
  const sight = await page.evaluate(() => {
    const viewer = (window as SodaWindow).__sodaViewer!
    const line = viewer.entities.values.find((entity) => entity.id.startsWith('tmtc-sight:'))
    return line?.polyline?.positions?.getValue(viewer.clock.currentTime)?.length ?? 0
  })
  expect(sight).toBe(2)
  const log = panel.getByTestId('tmtc-log')
  await expect(log).toContainText('playback')
  await expect(log).toContainText('command=NOOP')
  // The mode depends on what else commanded the spacecraft (an external control system may).
  await expect(panel.getByTestId('tmtc-hk')).toContainText('Battery')
  await page.screenshot({ path: `${SHOTS}/mission-tmtc-dark.png` })
  await panel.getByTestId('tmtc-stop').click()
  await expect(panel.getByTestId('tmtc-start')).toBeVisible()
})
