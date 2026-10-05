import { expect, test } from '@playwright/test'
import type { Entity, Polyline, PolylineCollection, Viewer } from 'cesium'
import { openSatelliteStep } from './rail'

type SodaWindow = Window & {
  __sodaViewer: Viewer
  __pathEvidence: {
    marker: Entity
    line: Polyline
    /** Where `line` sits in `collection`, and the vertex of it the marker reaches an hour in. */
    lineIndex: number
    vertexIndex: number
    collection: PolylineCollection
    sample: number[]
  }
}

test('both views retain the full Earth-fixed path and the same marker', async ({ page }) => {
  await page.goto('/?e2e&lang=ko', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#boot')).toBeHidden()
  await page.getByText('ISS', { exact: true }).click()
  await page.getByTestId('to-propagate').click()
  for (const [span, count] of [
    ['1일', 2881],
    ['7일', 20161],
  ] as const) {
    await page.getByTestId('satellite-step-propagate').click()
    await page.getByText(span, { exact: true }).click()
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/propagate') && r.ok()),
      page.getByRole('button', { name: '전파 실행' }).click(),
    ])
    // Each eclipse entry or exit between two samples adds one interpolated vertex to the path.
    const { eclipse_s, step_s } = (await response.json()) as {
      eclipse_s: number[] | null
      step_s: number
    }
    const cuts = (eclipse_s ?? []).filter((seconds) => seconds % step_s !== 0).length
    await expect(page.locator('.run-list .list-row')).toHaveAttribute(
      'title',
      new RegExp(count.toLocaleString('en-US')),
    )
    await expect
      .poll(() =>
        page.evaluate(() => {
          const v = (window as unknown as SodaWindow).__sodaViewer
          for (let i = 0; i < v.scene.primitives.length; i++) {
            const c = v.scene.primitives.get(i) as PolylineCollection
            if (c.length && typeof c.get === 'function' && c.get(0).id?.kind === 'orbit') {
              // The path splits where the element-age grade changes and at each eclipse
              // edge; neighbouring pieces share their end vertex.
              let total = 0
              for (let k = 0; k < c.length; k++) total += c.get(k).positions.length
              return total - (c.length - 1)
            }
          }
          return 0
        }),
      )
      .toBe(count + cuts)
  }
  await expect(page.getByRole('button', { name: '현재 주변', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '전체 기간', exact: true })).toHaveCount(0)
  await page.evaluate(() => {
    const w = window as unknown as SodaWindow
    const v = w.__sodaViewer
    v.clock.shouldAnimate = false
    v.clock.currentTime = v.clock.startTime.clone()
    const marker = v.entities.values.find((e) => e.id.startsWith('marker:'))!
    for (let i = 0; i < v.scene.primitives.length; i++) {
      const collection = v.scene.primitives.get(i) as PolylineCollection
      if (
        collection.length &&
        typeof collection.get === 'function' &&
        collection.get(0).id?.kind === 'orbit'
      ) {
        // The path is cut at eclipse edges, so look up the vertex of the sample an hour in
        // by where the marker will be then, instead of by a fixed index in the first piece.
        const later = v.clock.startTime.clone()
        later.secondsOfDay += 3600
        const target = marker.position!.getValue(later)!
        let best = { gap: Infinity, lineIndex: 0, vertexIndex: 0 }
        for (let k = 0; k < collection.length; k++) {
          collection.get(k).positions.forEach((q, vertexIndex) => {
            const gap = Math.hypot(q.x - target.x, q.y - target.y, q.z - target.z)
            if (gap < best.gap) best = { gap, lineIndex: k, vertexIndex }
          })
        }
        const line = collection.get(best.lineIndex)
        const p = line.positions[best.vertexIndex]!
        w.__pathEvidence = {
          marker,
          line,
          lineIndex: best.lineIndex,
          vertexIndex: best.vertexIndex,
          collection,
          sample: [p.x, p.y, p.z],
        }
        break
      }
    }
  })
  const inspect = () =>
    page.evaluate(() => {
      const w = window as unknown as SodaWindow
      const v = w.__sodaViewer
      const { marker, line, lineIndex, vertexIndex, collection, sample } = w.__pathEvidence
      const vertex = line.positions[vertexIndex]!
      const p = marker.position!.getValue(v.clock.currentTime)!
      const station = v.entities.values.find((e) => e.id.startsWith('station:'))
      const stationPosition = station?.position?.getValue(v.clock.currentTime)
      return {
        sameMarker: v.entities.getById(marker.id) === marker,
        sameLine: collection.get(lineIndex) === line,
        positions: line.positions.length,
        sample: [vertex.x, vertex.y, vertex.z],
        model: Array.from({ length: 16 }, (_, i) => collection.modelMatrix[i]),
        camera: [v.camera.positionWC.x, v.camera.positionWC.y, v.camera.positionWC.z],
        station: stationPosition ? [stationPosition.x, stationPosition.y, stationPosition.z] : [],
        markerGap: Math.hypot(p.x - sample[0]!, p.y - sample[1]!, p.z - sample[2]!),
        markerPosition: [p.x, p.y, p.z],
        material: line.material.type,
      }
    })
  const before = await inspect()
  await page.getByRole('button', { name: '관성 (ECI)', exact: true }).click()
  await page.getByRole('button', { name: 'ECI로 전환', exact: true }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '관성 (ECI)', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.waitForTimeout(200)
  const switched = await inspect()
  expect(switched.sameMarker && switched.sameLine).toBe(true)
  expect(switched.model).toEqual(before.model)
  expect(switched.sample).toEqual(before.sample)
  expect(switched.markerPosition).toEqual(before.markerPosition)
  await page.evaluate(() => {
    const v = (window as unknown as SodaWindow).__sodaViewer
    v.clock.currentTime = v.clock.startTime.clone()
    v.clock.currentTime.secondsOfDay += 3600
  })
  await expect.poll(async () => (await inspect()).markerGap).toBeLessThan(0.01)
  await page.waitForTimeout(200)
  const later = await inspect()
  expect(later.camera).not.toEqual(before.camera)
  expect(later.station).toEqual(before.station)
  expect(later.model).toEqual(before.model)
  expect(later.sample).toEqual(before.sample)
  // The piece of the path under test keeps every one of its vertices.
  expect(later.positions).toBe(before.positions)
  expect(later.material).toBe('Color')
  await page.screenshot({
    path: '../.cache/screenshots/earth-relative-eci-ko.png',
    animations: 'disabled',
  })
  await page.getByRole('button', { name: '지구고정 (ECEF)', exact: true }).click()
  await page.waitForTimeout(200)
  const fixed = await inspect()
  await page.evaluate(() => {
    ;(window as unknown as SodaWindow).__sodaViewer.clock.currentTime.secondsOfDay += 600
  })
  await page.waitForTimeout(200)
  const advanced = await inspect()
  expect(advanced.camera).toEqual(fixed.camera)
  expect(advanced.markerPosition).not.toEqual(fixed.markerPosition)
  expect(advanced.sameMarker && advanced.sameLine).toBe(true)
  expect(advanced.sample).toEqual(before.sample)
})

test('frame confirmation can be cancelled and startup ignores saved ECI', async ({ page }) => {
  await page.goto('/?e2e&lang=en', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() =>
    localStorage.setItem('soda.layers', JSON.stringify({ frame: 'inertial' })),
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'runs')
  const fixed = page.getByRole('button', { name: 'Earth-fixed (ECEF)', exact: true })
  const inertial = page.getByRole('button', { name: 'Inertial (ECI)', exact: true })
  await expect(fixed).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Around now', exact: true })).toHaveCount(0)
  for (const cancel of ['button', 'escape', 'outside']) {
    await inertial.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog').locator('.v-overlay__content')).toBeFocused()
    await expect(fixed).toHaveAttribute('aria-pressed', 'true')
    if (cancel === 'button') await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    else if (cancel === 'escape') await page.keyboard.press('Escape')
    else await page.mouse.click(10, 10)
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(fixed).toHaveAttribute('aria-pressed', 'true')
  }
  await inertial.click()
  await expect(page.getByRole('dialog').locator('.v-overlay__content')).toBeFocused()
  await page.screenshot({
    path: '../.cache/screenshots/eci-confirm-en.png',
    animations: 'disabled',
  })
  await page.getByRole('button', { name: 'Switch to ECI', exact: true }).click()
  await expect(inertial).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'runs')
  await expect(fixed).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Around now', exact: true })).toHaveCount(0)
})

test('a click between two orbit samples puts the marker under the click', async ({ page }) => {
  await page.goto('/?e2e&lang=ko', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#boot')).toBeHidden()
  await page.getByText('ISS', { exact: true }).click()
  await page.getByTestId('to-propagate').click()
  // A day is sampled every 30 s, about 230 km apart.
  await page.getByText('1일', { exact: true }).click()
  await page.getByRole('button', { name: '전파 실행' }).click()
  await expect(page.locator('.run-list .list-row')).toBeVisible()
  // Paused and zoomed in, so two neighbouring samples are a few dozen pixels apart.
  await page.evaluate(() => {
    const viewer = (window as unknown as SodaWindow).__sodaViewer
    viewer.clock.shouldAnimate = false
    viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.75)
  })
  await page.waitForTimeout(1500)

  // The middle of a stretch between two neighbouring samples, both on this side of the globe
  // and far enough apart on screen that snapping to either would be plain to see.
  const middle = await page.evaluate(() => {
    const { scene } = (window as unknown as SodaWindow).__sodaViewer
    const box = scene.canvas.getBoundingClientRect()
    for (let p = 0; p < scene.primitives.length; p++) {
      const collection = scene.primitives.get(p) as PolylineCollection
      if (!(collection.length > 0) || typeof collection.get !== 'function') continue
      if ((collection.get(0).id as { kind?: string } | undefined)?.kind !== 'orbit') continue
      for (let k = 0; k < collection.length; k++) {
        const positions = collection.get(k).positions
        for (let i = 0; i + 1 < positions.length; i++) {
          const a = scene.cartesianToCanvasCoordinates(positions[i]!)
          const b = scene.cartesianToCanvasCoordinates(positions[i + 1]!)
          if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < 24) continue
          const x = (a.x + b.x) / 2
          const y = (a.y + b.y) / 2
          if (x < 450 || x > 1150 || y < 80 || y > 700) continue
          if (document.elementFromPoint(box.left + x, box.top + y) !== scene.canvas) continue
          const picked = scene.pick({ x, y } as never, 6, 6) as { id?: { kind?: string } }
          if (picked?.id?.kind === 'orbit') return { x: box.left + x, y: box.top + y }
        }
      }
    }
    return null
  })
  expect(middle, 'a stretch between two samples should be clickable').not.toBeNull()
  await page.mouse.click(middle!.x, middle!.y)

  const markerOffset = () =>
    page.evaluate((click) => {
      const viewer = (window as unknown as SodaWindow).__sodaViewer
      const marker = viewer.entities.values.find((entity) => entity.id.startsWith('marker:'))
      const position = marker?.position?.getValue(viewer.clock.currentTime)
      const xy = position && viewer.scene.cartesianToCanvasCoordinates(position)
      if (!xy) return Number.POSITIVE_INFINITY
      const box = viewer.scene.canvas.getBoundingClientRect()
      return Math.hypot(box.left + xy.x - click.x, box.top + xy.y - click.y)
    }, middle!)
  // Snapping to the nearer sample would leave it 12 px or more away.
  await expect.poll(markerOffset).toBeLessThan(5)
})
