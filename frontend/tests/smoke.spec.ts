import { expect, test, type Page } from '@playwright/test'
import type { Polyline, PolylineCollection, Viewer } from 'cesium'
import { ensurePresetStation } from './stations'

const SHOTS = '../.cache/screenshots'

type SodaWindow = Window & { __sodaViewer?: Viewer }

async function waitForGlobe(page: Page) {
  await page.waitForFunction(() => Boolean((window as SodaWindow).__sodaViewer))
  await page.waitForTimeout(3000)
}

/** Canvas coordinates of a visible, pickable point on the first orbit path. */
async function orbitPixel(page: Page) {
  return page.evaluate(() => {
    const { scene } = (window as SodaWindow).__sodaViewer!
    for (let p = 0; p < scene.primitives.length; p++) {
      const collection = scene.primitives.get(p) as PolylineCollection
      if (!(collection.length > 0) || typeof collection.get !== 'function') continue
      const first: Polyline = collection.get(0)
      if ((first.id as { kind?: string } | undefined)?.kind !== 'orbit') continue
      // The path is cut where the element-age grade changes and at each eclipse edge.
      const positions = Array.from(
        { length: collection.length },
        (_, k) => collection.get(k).positions,
      ).flat()
      for (let i = 0; i < positions.length; i += 7) {
        const xy = scene.cartesianToCanvasCoordinates(positions[i]!)
        if (!xy || xy.x < 450 || xy.x > 1150 || xy.y < 80 || xy.y > 700) continue
        // A point under the side bar or the dock is not clickable.
        const box = scene.canvas.getBoundingClientRect()
        if (document.elementFromPoint(box.left + xy.x, box.top + xy.y) !== scene.canvas) continue
        const picked = scene.pick(xy, 6, 6) as { id?: { kind?: string } } | undefined
        if (picked?.id?.kind === 'orbit') return { x: xy.x, y: xy.y }
      }
    }
    return null
  })
}

/** Point the camera straight down at the selected satellite from ``height`` metres. */
async function lookAtSatellite(page: Page, height: number) {
  await page.evaluate((h) => {
    const viewer = (window as SodaWindow).__sodaViewer!
    const marker = viewer.entities.values.find((e) => e.id.startsWith('marker:'))!
    const position = marker.position!.getValue(viewer.clock.currentTime)!
    const ellipsoid = viewer.scene.globe.ellipsoid
    const carto = ellipsoid.cartesianToCartographic(position)
    carto.height = h
    viewer.camera.setView({ destination: ellipsoid.cartographicToCartesian(carto) })
  }, height)
}

test('propagate ISS, click its orbit, and inspect the swath', async ({ page }) => {
  // ``lang=ko`` pins the language so these Korean selectors do not depend on the
  // machine's browser settings, and so the screenshots stay comparable.
  await page.goto('/?e2e&lang=ko')
  await waitForGlobe(page)
  // The boot splash must step aside once the globe draws, or every click below lands on it.
  await expect(page.locator('#boot')).toBeHidden()
  await expect(page.getByText(/CelesTrak ·/)).toBeVisible()
  await page.waitForTimeout(4000)
  await page.screenshot({ path: `${SHOTS}/globe-dark.png` })

  // Without an ion token, the SODA mark takes the Cesium ion logo's place.
  await expect(page.locator('.soda-credit')).toBeVisible()

  await page.getByText('ISS', { exact: true }).click()
  // A satellite clicked on the globe lands in the basket; its row unfolds into the details.
  const basket = page.getByTestId('satellite-basket')
  await expect(basket).toContainText('ISS (ZARYA)')
  await basket.getByTestId('satellite-expand-norad:25544').click()
  await expect(basket.getByTestId('facts-norad:25544')).toContainText('Epoch')
  await page.screenshot({ path: `${SHOTS}/satellite-detail-dark.png` })
  await page.getByTestId('to-propagate').click()
  await page.getByText('6시간', { exact: true }).click()
  await page.screenshot({ path: `${SHOTS}/propagate-form-dark.png` })
  await page.getByRole('button', { name: '전파 실행' }).click()
  await expect(page.getByRole('button', { name: /^ISS \(ZARYA\).*간격/ })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/satellite-merged-dark.png` })

  const canvas = page.locator('.cesium-widget canvas')
  const box = (await canvas.boundingBox())!
  await page.waitForTimeout(1500)
  const pixel = await orbitPixel(page)
  expect(pixel, 'an orbit sample should be visible on screen').not.toBeNull()
  await page.mouse.click(box.x + pixel!.x, box.y + pixel!.y)

  // The swath tool waits for its switch: nothing is computed until drawing is turned on.
  await page.getByRole('button', { name: '관측폭', exact: true }).click()
  const inspector = page.getByTestId('tool-sidebar')
  await expect(inspector.getByTestId('swath-draw').locator('input')).not.toBeChecked()
  await expect(inspector.getByTestId('swath-stats')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/swath-off-dark.png` })
  await inspector.getByTestId('swath-draw').locator('input').check()
  const nadirStat = inspector.getByTestId('swath-stats').locator('.stat').first()
  await expect(nadirStat).toContainText('Nadir 관측폭')
  await expect(nadirStat).toContainText('12.0')
  await page.waitForTimeout(5000)
  await page.screenshot({ path: `${SHOTS}/swath-dark.png` })
  // "Custom" sticks even while the values still equal the preset, and a preset tile comes back.
  const customTile = inspector.getByTestId('sensor-preset-custom')
  await customTile.click()
  await expect(customTile).toHaveAttribute('aria-checked', 'true')
  await expect(inspector.getByTestId('sensor-preset-hr-eo')).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await inspector.getByTestId('sensor-preset-hr-eo').click()
  await expect(inspector.getByTestId('sensor-preset-hr-eo')).toHaveAttribute('aria-checked', 'true')
  // Custom values save as a preset in the database; the same name offers an overwrite, and the
  // tile's delete removes it again (the smoke run shares the real database, so it cleans up).
  const savedTile = inspector.locator('[data-testid^="sensor-preset-user:"]')
  const presetName = `E2E ${Date.now()}`
  await inspector.getByRole('spinbutton', { name: 'Nadir 관측폭' }).fill('33')
  await expect(customTile).toHaveAttribute('aria-checked', 'true')
  await inspector.getByTestId('sensor-preset-save-open').click()
  await inspector.getByTestId('sensor-preset-name').locator('input').fill(presetName)
  await inspector.getByTestId('sensor-preset-save').click()
  await expect(savedTile).toHaveCount(1)
  await expect(savedTile).toHaveAttribute('aria-checked', 'true')
  await expect(savedTile).toContainText('33 km')
  await inspector.getByRole('spinbutton', { name: 'Nadir 관측폭' }).fill('34')
  await inspector.getByTestId('sensor-preset-save-open').click()
  await inspector.getByTestId('sensor-preset-name').locator('input').fill(presetName)
  await inspector.getByTestId('sensor-preset-save').click()
  await inspector.getByTestId('sensor-preset-overwrite').click()
  await expect(savedTile).toContainText('34 km')
  await expect(savedTile).toHaveAttribute('aria-checked', 'true')
  await page.screenshot({ path: `${SHOTS}/swath-saved-preset-dark.png` })
  await savedTile.hover()
  await inspector.locator('[data-testid^="sensor-preset-delete-user:"]').click()
  await expect(savedTile).toHaveCount(0)
  await inspector.getByTestId('sensor-preset-hr-eo').click()
  await expect(inspector.getByTestId('sensor-preset-hr-eo')).toHaveAttribute('aria-checked', 'true')

  // The chip says a run is selected; applying new sensor settings shows the busy card until the
  // swath primitives are drawn, then the field-of-regard width follows the new roll limit.
  await expect(page.getByTestId('selection-chip')).toContainText('ISS (ZARYA)')
  const regardStat = inspector.getByTestId('swath-stats').locator('.stat').nth(1)
  const regardBefore = await regardStat.innerText()
  await inspector.getByLabel('최대 기울임').fill('20')
  await inspector.getByRole('button', { name: '적용' }).click()
  await expect(page.locator('.swath-busy')).toBeHidden()
  await expect(regardStat).not.toHaveText(regardBefore)

  // The picker says which element set the run came from; sections fold one by one.
  await expect(inspector.getByTestId('swath-run-select')).toContainText('Epoch')
  const sensorFold = inspector.getByTestId('fold-swath.sensor')
  await sensorFold.click()
  await expect(sensorFold).toHaveAttribute('aria-expanded', 'false')
  await sensorFold.click()
  await expect(sensorFold).toHaveAttribute('aria-expanded', 'true')

  // Tooltips use the theme's readable pair rather than Vuetify's fallback text colour.
  await page.getByRole('button', { name: '궤도 전파', exact: true }).hover()
  const tooltip = page.locator('.v-tooltip > .v-overlay__content', { hasText: '궤도 전파' })
  await expect(tooltip).toBeVisible()
  await tooltip.screenshot({ path: `${SHOTS}/tooltip-dark.png` })
  await page.mouse.move(box.x + box.width / 2, box.y + 40)

  await page.keyboard.press('?')
  await expect(page.locator('.help-card')).toContainText('궤도 선 클릭')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/help-dark.png` })
  // Escape closes the help menu first and keeps the selection; a second press clears it.
  await page.keyboard.press('Escape')
  await expect(page.locator('.help-card')).toBeHidden()
  await expect(page.getByTestId('selection-chip')).toBeVisible()
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('selection-chip')).toBeHidden()
  // With no run selected the swath tool lists the propagated satellites; picking one redraws
  // (the switch stays on).
  await inspector.getByTestId('swath-run-select').click()
  await expect(page.getByRole('option', { name: /ISS \(ZARYA\)/ })).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SHOTS}/swath-run-menu-dark.png` })
  await page.getByRole('option', { name: /ISS \(ZARYA\)/ }).click()
  await expect(nadirStat).toContainText('12.0')
  await page.getByRole('button', { name: '궤도 전파', exact: true }).click()

  await lookAtSatellite(page, 2_500_000)
  await page.waitForTimeout(6000)
  await page.screenshot({ path: `${SHOTS}/swath-zoom-dark.png` })

  await page.getByRole('button', { name: '따라가기', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => (window as SodaWindow).__sodaViewer!.trackedEntity?.id ?? ''))
    .toMatch(/^marker:/)
  await page.waitForTimeout(4000)
  await page.screenshot({ path: `${SHOTS}/track-dark.png` })

  // The generated cube is the default marker; swapping to a point and back keeps the camera.
  const markerHasModel = () =>
    page.evaluate(() => {
      const viewer = (window as SodaWindow).__sodaViewer!
      return Boolean(viewer.entities.values.find((e) => e.id.startsWith('marker:'))?.model)
    })
  await expect.poll(markerHasModel).toBe(true)
  await page.getByRole('button', { name: '지도와 표시' }).click()
  await page.getByRole('tab', { name: '위성 표시' }).click()
  await page.getByRole('button', { name: '점', exact: true }).click()
  await expect.poll(markerHasModel).toBe(false)
  await page.waitForTimeout(4000)
  await page.screenshot({ path: `${SHOTS}/track-point-dark.png` })
  await page.getByRole('button', { name: '큐브', exact: true }).click()
  await expect.poll(markerHasModel).toBe(true)
  await page.getByRole('button', { name: '궤도 전파', exact: true }).click()
  await page.getByRole('button', { name: '따라가기 해제', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => Boolean((window as SodaWindow).__sodaViewer!.trackedEntity)))
    .toBe(false)
  await lookAtSatellite(page, 2_500_000)

  await page.waitForTimeout(6000)
  await page.screenshot({ path: `${SHOTS}/swath-zoom.png` })

  await page.getByRole('button', { name: '패스 예측' }).click()
  await page.getByRole('button', { name: '패스 계산' }).click()
  await expect(page.getByText(/회 · 가시권 반경/)).toBeVisible()
  // The visibility area is tinted as an imagery overlay above the basemap.
  await expect
    .poll(() => page.evaluate(() => (window as SodaWindow).__sodaViewer!.imageryLayers.length))
    .toBe(2)
  await page.evaluate(() => {
    const viewer = (window as SodaWindow).__sodaViewer!
    viewer.camera.setView({
      destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: (127.38 * Math.PI) / 180,
        latitude: (30 * Math.PI) / 180,
        height: 9_000_000,
      } as never),
    })
  })
  // Every contact is drawn on the globe until its eye toggle hides it.
  const passTracks = () =>
    page.evaluate(
      () =>
        (window as SodaWindow).__sodaViewer!.entities.values.filter((e) => e.id.startsWith('pass:'))
          .length,
    )
  const toggles = page.getByTestId('pass-visibility')
  const total = await toggles.count()
  expect(total).toBeGreaterThan(0)
  // Each shown contact also gets an AOS and a LOS pin.
  const passEnds = () =>
    page.evaluate(
      () =>
        (window as SodaWindow).__sodaViewer!.entities.values.filter((e) =>
          e.id.startsWith('pass-end:'),
        ).length,
    )
  const imagery = () =>
    page.evaluate(() => (window as SodaWindow).__sodaViewer!.imageryLayers.length)
  await expect.poll(passTracks).toBe(total)
  await expect.poll(passEnds).toBe(2 * total)
  await toggles.first().click()
  await expect.poll(passTracks).toBe(total - 1)
  await expect.poll(passEnds).toBe(2 * (total - 1))
  await toggles.first().click()
  await expect.poll(passTracks).toBe(total)
  // With every contact switched off the station's visibility area goes too.
  await page.getByRole('button', { name: '모두 숨기기' }).click()
  await expect.poll(imagery).toBe(1)
  await page.getByRole('button', { name: '모두 표시' }).click()
  await expect.poll(imagery).toBe(2)
  await expect(page.locator('.pass-row').first()).toContainText('#1')
  // The docks start as icons; hovering one pops its piece up, the pin keeps it in the dock.
  const dock = page.getByTestId('pass-timeline-dock')
  await expect(dock).toHaveCount(0)
  await expect(page.locator('.timeline')).toHaveCount(0)
  await page.getByTestId('tray-pass-timeline').hover()
  await expect(dock).toBeVisible()
  await expect(dock).toHaveClass(/dock-peek/)
  await page.screenshot({ path: `${SHOTS}/passes-peek-mission-control.png` })
  await dock.getByTestId('pass-timeline-pin').click()
  await expect(dock).not.toHaveClass(/dock-peek/)
  await expect(page.getByTestId('tray-pass-timeline')).toHaveCount(0)
  await page.mouse.move(10, 400)
  await expect(dock).toBeVisible()
  await page.getByTestId('tray-clock').hover()
  await expect(page.locator('.timeline')).toBeVisible()
  // The speed menu sits outside the popped-up clock, so the clock holds while it is open.
  const speedButton = page.locator('.timeline .speed')
  await speedButton.click()
  const fastest = page.locator('.v-overlay-container .v-list-item', { hasText: '3600×' })
  await fastest.hover()
  await page.waitForTimeout(600)
  await expect(page.locator('.timeline')).toBeVisible()
  await page.locator('.v-overlay-container .v-list-item', { hasText: /^\s*1×\s*$/ }).click()
  await expect(speedButton).toContainText('1×')
  await page.mouse.move(10, 400)
  await expect(page.locator('.timeline')).toHaveCount(0)
  await page.getByTestId('pass-timeline-dock').locator('.bar').first().click()
  await expect(page.locator('.pass-row.selected')).toHaveCount(1)
  await expect(page.getByTestId('contact-chip').first()).toBeVisible()
  await page.waitForTimeout(6000)
  await page.screenshot({ path: `${SHOTS}/passes-mission-control.png` })

  // The side bar sits flush against the rail, and the dock starts past it rather than under it.
  const dockBox = (await dock.boundingBox())!
  const railBox = (await page.locator('.tool-rail').boundingBox())!
  const sideBox = (await page.getByTestId('tool-sidebar').boundingBox())!
  expect(Math.abs(sideBox.x - (railBox.x + railBox.width))).toBeLessThanOrEqual(1)
  expect(dockBox.x).toBeGreaterThanOrEqual(sideBox.x + sideBox.width)
  // Pinning the clock too; unpinning (or `t` for the timeline) drops a piece back to its icon.
  await page.getByTestId('tray-clock').hover()
  await page.locator('.timeline').getByTestId('clock-pin').click()
  await expect(page.getByTestId('tray-clock')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/passes-pinned-mission-control.png` })
  await page.keyboard.press('t')
  await expect(dock).toHaveCount(0)
  await expect(page.getByTestId('tray-pass-timeline')).toBeVisible()
  await page.locator('.timeline').getByTestId('clock-pin').click()
  await expect(page.locator('.timeline')).toHaveCount(0)
  await expect(page.getByTestId('tray-clock')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/passes-folded-mission-control.png` })
  await page.keyboard.press('t')
  await expect(dock.locator('.grid')).toBeVisible()
  // `[` folds the tool panel away and brings the same tool back.
  await page.keyboard.press('[')
  await expect(page.getByTestId('tool-sidebar')).toHaveCount(0)
  await page.keyboard.press('[')
  await expect(page.getByRole('button', { name: '패스 계산' })).toBeVisible()

  await page.getByRole('button', { name: '지도와 표시' }).click()
  await page.getByRole('tab', { name: '위성 표시' }).click()
  await expect(page.getByText('공통 기본 로고')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/markers-mission-control.png` })

  await page.getByRole('tab', { name: '레이어', exact: true }).click()
  await expect(page.getByRole('button', { name: 'DEBRIS 색 변경' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/layers-cloud-style.png` })
})

test('boot splash shows the primary lockup', async ({ page }) => {
  // ``?splash=hold`` keeps the splash up long enough to photograph.
  await page.goto('/?splash=hold&lang=ko', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#boot img')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: `${SHOTS}/boot-dark.png` })
})

test('english locale renders the app without Korean', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await waitForGlobe(page)
  await expect(page.locator('#boot')).toBeHidden()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  await page.getByText('ISS', { exact: true }).click()
  await expect(page.getByTestId('satellite-basket')).toContainText('ISS (ZARYA)')
  await page.getByRole('button', { name: 'Pass prediction' }).click()
  await expect(page.getByRole('button', { name: 'Predict passes' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/app-en.png` })

  await page.getByRole('button', { name: 'Add station' }).click()
  await expect(page.getByRole('button', { name: 'From catalogue' })).toBeVisible()
  const country = page.locator('.station-picker .country-head').first()
  await country.click()
  await expect(country).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.station-picker .country-body').first()).toBeVisible()
  await page
    .locator('.station-picker')
    .screenshot({ path: `${SHOTS}/stations-picker-en.png`, animations: 'disabled' })

  // Only names typed in by hand are the reader's own and stay as entered. A station from
  // the catalogue follows the language like every other string on screen.
  const typed = await page.evaluate(() =>
    [...document.querySelectorAll('.station-list .list-row strong[data-hand-entered]')].map(
      (node) => node.textContent ?? '',
    ),
  )
  const leaked = await page.evaluate((names: string[]) => {
    let text = document.querySelector('.soda-main')?.textContent ?? ''
    for (const name of names) text = text.split(name).join('')
    return [...text].filter((ch) => /[\u3131-\u318e\uac00-\ud7a3]/.test(ch)).join('')
  }, typed)
  expect(leaked).toBe('')
})

test('settings dialog switches the glass look and reports the database', async ({ page }) => {
  await page.goto('/?e2e&lang=ko')
  await waitForGlobe(page)
  await expect(page.locator('#boot')).toBeHidden()
  const glass = () => page.evaluate(() => document.documentElement.dataset.glass)
  expect(await glass()).toBe('on')
  await page.getByRole('button', { name: '지도와 표시' }).click()
  await page.getByRole('tab', { name: '장소' }).click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOTS}/glass-on.png` })

  await page.getByTestId('settings-open').click()
  await expect(page.getByTestId('glass-switch')).toBeVisible()
  // The reset asks first; cancelling keeps everything.
  await page.getByTestId('reset-start').click()
  await expect(page.getByTestId('reset-confirm')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/settings-general.png` })
  await page.getByTestId('reset-confirm').getByRole('button', { name: '취소' }).click()
  await expect(page.getByTestId('reset-start')).toBeVisible()
  await page.getByTestId('glass-switch').locator('input').uncheck()
  await expect.poll(glass).toBe('off')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('glass-switch')).toBeHidden()
  await page.screenshot({ path: `${SHOTS}/glass-off.png` })

  // Only a probe: saving would write the developer's settings.local.toml.
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-tab-database').click()
  await expect(page.getByTestId('database-path')).toContainText('soda.db')
  await page
    .getByTestId('database-url')
    .locator('input')
    .fill('sqlite:///.cache/e2e-probe/never-created.db')
  await page.getByRole('button', { name: '연결 테스트' }).click()
  await expect(page.getByTestId('database-probe')).toContainText('다음 시작 때 새로 생성')
  await expect(page.getByTestId('backup-export')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/settings-database.png` })

  // The browser pages through raw rows. Only a fresh database is seeded with Naro, so the
  // test adds it from the preset when the user's database lacks it, and removes it after.
  const removeNaro = await ensurePresetStation(page.request, 'kari-naro')
  try {
    await page.getByTestId('settings-tab-browse').click()
    const rows = page.getByTestId('browse-rows')
    await expect(rows).toContainText('kari-naro')
    await page.getByTestId('browse-search').locator('input').fill('nowhere')
    await expect(rows).toContainText('행 없음')
    await page.getByTestId('browse-search').locator('input').fill('')
    await expect(rows).toContainText('kari-naro')
    await page.screenshot({ path: `${SHOTS}/settings-browse.png` })
  } finally {
    await removeNaro()
  }
})
