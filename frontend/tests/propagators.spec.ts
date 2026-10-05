import { expect, test } from '@playwright/test'
import { openSatelliteStep, openTool } from './rail'

const SHOTS = '../.cache/screenshots'
const DAY_MS = 86_400_000

/** `datetime-local` value for a UTC instant, as the start field takes it. */
function utcInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16)
}

test('HPOP propagates the ISS, labels the run, and the pass tool says it uses SGP4', async ({
  page,
}) => {
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()
  const catalog = await (await page.request.get('/api/v1/catalog/25544')).json()
  const epochMs = Date.parse(catalog.epoch)

  await openSatelliteStep(page, 'pick')
  const sidebar = page.getByTestId('tool-sidebar')
  await sidebar.getByTestId('pick-norad:25544').click()
  await sidebar.getByTestId('to-propagate').click()
  const start = sidebar.getByLabel('Start (UTC)')
  const run = page.getByRole('button', { name: 'Propagate', exact: true })

  // SGP4 is the default and the only thing on show; the choice sits under Advanced.
  await expect(sidebar.getByTestId('propagator')).toBeHidden()
  await expect(sidebar.getByTestId('hpop-experimental')).toHaveCount(0)
  await sidebar.getByTestId('propagate-advanced').click()
  await sidebar.getByTestId('propagator').getByText('HPOP', { exact: true }).click()
  // Choosing HPOP says that it is experimental, and what it is and is not good for.
  await expect(sidebar.getByTestId('hpop-experimental')).toContainText('Experimental')
  await expect(sidebar.getByTestId('hpop-caveat')).toContainText('not more accurate than SGP4')
  await expect(sidebar.getByTestId('hpop-options')).toBeVisible()
  await sidebar.getByTestId('hpop-gravity').getByText('20×20').click()
  await sidebar.getByTestId('hpop-srp').locator('input').uncheck()
  await sidebar.getByTestId('hpop-mass').locator('input').fill('420000')
  await sidebar.getByTestId('hpop-area').locator('input').fill('1600')

  // A window too far from the element epoch is refused before it is sent.
  await start.fill(utcInput(epochMs + 9 * DAY_MS))
  await expect(sidebar.getByTestId('hpop-epoch-too-far')).toContainText('within 7 days')
  await expect(run).toBeDisabled()

  await start.fill(utcInput(epochMs))
  await expect(sidebar.getByTestId('hpop-epoch-too-far')).toHaveCount(0)
  await page.getByText('6 hours', { exact: true }).click()
  await page.screenshot({ path: `${SHOTS}/propagate-hpop-dark.png` })
  const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/propagate'))
  await run.click()
  const body = await (await response).json()
  expect(body.propagator).toBe('hpop')
  expect(body.force_model).toMatchObject({
    gravity_degree: 20,
    srp: false,
    mass_kg: 420000,
    drag_area_m2: 1600,
    spacecraft_source: 'default',
  })
  expect(body.invalid).toEqual([])

  await expect(sidebar.locator('[data-testid^="run-propagator-"]')).toHaveText('HPOP')
  await expect(sidebar.getByTestId('run-experimental')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/runs-hpop-dark.png` })

  await openTool(page, 'Pass prediction')
  await expect(page.getByTestId('sgp4-only-note')).toContainText('computed with SGP4')
  await expect(page.getByTestId('sgp4-only-note')).toContainText('ISS')
})

test('a state vector is saved, propagated with HPOP, and left out of the pass tool', async ({
  page,
}) => {
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'pick')
  const sidebar = page.getByTestId('tool-sidebar')
  const basket = sidebar.getByTestId('satellite-basket')
  const name = `E2E STATE ${Date.now()}`
  const field = (id: string) => sidebar.getByTestId(id).locator('input')
  // A circular orbit 700 km up, inclined 53 degrees.
  const velocity = ['0', '4.502572', '6.003429']
  const fill = async (position: string[]) => {
    for (const [index, value] of position.entries()) {
      await field(`state-position-${index}`).fill(value)
    }
    for (const [index, value] of velocity.entries()) {
      await field(`state-velocity-${index}`).fill(value)
    }
  }

  await sidebar.getByTestId('tab-custom').click()
  await sidebar.getByTestId('custom-kind-state').click()
  const save = sidebar.getByTestId('state-save')
  await expect(save).toBeDisabled()
  await field('state-name').fill(name)
  await field('state-epoch').fill('2026-09-16T00:00')
  await fill(['7078.1363', '0', '0'])
  await field('state-mass').fill('120')
  await page.screenshot({ path: `${SHOTS}/picker-state-vector-dark.png` })
  await save.click()
  await expect(basket).toContainText(name)
  await expect(basket).toContainText('User state vector')
  const saved = sidebar.getByTestId('custom-states').locator('.sat-item', { hasText: name })
  await expect(saved).toContainText('GCRF · FORM')

  // An unusable state is refused with the reason: this one is 22 km up.
  await field('state-name').fill(`${name} low`)
  await fill(['6400', '0', '0'])
  await save.click()
  await expect(sidebar.getByText('The state vector is not usable')).toBeVisible()

  // It can only be integrated: the form says so whatever propagator is chosen.
  await sidebar.getByTestId('to-propagate').click()
  const targets = sidebar.getByTestId('propagate-targets')
  await expect(targets).toContainText('User state vector')
  await expect(targets.locator('.v-chip')).toHaveText('HPOP')
  await expect(sidebar.getByTestId('hpop-options')).toBeVisible()
  await expect(sidebar.getByTestId('hpop-experimental')).toContainText('Experimental')
  await expect(sidebar.getByTestId('hpop-caveat')).toHaveCount(0)
  await sidebar.getByLabel('Start (UTC)').fill('2026-09-16T00:00')
  await page.getByText('6 hours', { exact: true }).click()
  const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/propagate'))
  await page.getByRole('button', { name: 'Propagate', exact: true }).click()
  const body = await (await response).json()
  expect(body.propagator).toBe('hpop')
  expect(body.force_model).toMatchObject({ initial_state: 'stateVector', mass_kg: 120 })
  expect(body.element_set).toMatchObject({ name, norad_id: 0, tle: null, omm: null })
  expect(body.invalid).toEqual([])
  await expect(sidebar.locator('[data-testid^="run-propagator-"]')).toHaveText('HPOP')
  await page.screenshot({ path: `${SHOTS}/runs-state-vector-dark.png` })

  await openTool(page, 'Pass prediction')
  await expect(page.getByTestId('needs-elements-note')).toContainText(name)

  await page.request.delete(`/api/v1/custom-states/${body.element_set.state_id}`)
})

/** A CCSDS OEM for a circular orbit 700 km up: two hours from 2026-09-16T00:00, every minute. */
function circularOem(name: string): string {
  const radiusKm = 7078.1363
  const rate = Math.sqrt(398600.4415 / radiusKm ** 3)
  const [cosI, sinI] = [0.6, 0.8]
  const rows = Array.from({ length: 121 }, (_, minute) => {
    const angle = rate * minute * 60
    const [c, s] = [Math.cos(angle), Math.sin(angle)]
    const state = [
      radiusKm * c,
      radiusKm * s * cosI,
      radiusKm * s * sinI,
      -radiusKm * rate * s,
      radiusKm * rate * c * cosI,
      radiusKm * rate * c * sinI,
    ]
    const time = new Date(Date.UTC(2026, 8, 16, 0, minute)).toISOString().slice(0, 19)
    return `${time} ${state.map((value) => value.toFixed(9)).join(' ')}`
  })
  return [
    'CCSDS_OEM_VERS = 2.0',
    'CREATION_DATE = 2026-09-16T00:00:00',
    'ORIGINATOR = E2E',
    'META_START',
    `OBJECT_NAME = ${name}`,
    'OBJECT_ID = 2026-001A',
    'CENTER_NAME = EARTH',
    'REF_FRAME = GCRF',
    'TIME_SYSTEM = UTC',
    'START_TIME = 2026-09-16T00:00:00',
    'STOP_TIME = 2026-09-16T02:00:00',
    'META_STOP',
    ...rows,
    '',
  ].join('\n')
}

test('an OEM file is imported and shown only inside the span it covers', async ({ page }) => {
  await page.goto('/?e2e&lang=en')
  await expect(page.locator('#boot')).toBeHidden()
  await openSatelliteStep(page, 'pick')
  const sidebar = page.getByTestId('tool-sidebar')
  const basket = sidebar.getByTestId('satellite-basket')
  const name = `E2E OEM ${Date.now()}`

  await sidebar.getByTestId('tab-custom').click()
  await sidebar.getByTestId('custom-kind-ephemeris').click()
  const input = sidebar.getByTestId('ephemeris-file-input')
  await input.setInputFiles({
    name: 'bad.oem',
    mimeType: 'text/plain',
    buffer: Buffer.from(circularOem(name).replace('TIME_SYSTEM = UTC', 'TIME_SYSTEM = GPS')),
  })
  await expect(sidebar.getByText('OEM time system GPS is not supported')).toBeVisible()
  await input.setInputFiles({
    name: 'orbit.oem',
    mimeType: 'text/plain',
    buffer: Buffer.from(circularOem(name)),
  })
  await expect(basket).toContainText(name)
  await expect(basket).toContainText('User ephemeris')
  const saved = sidebar.getByTestId('custom-ephemerides').locator('.sat-item', { hasText: name })
  await expect(saved).toContainText('GCRF · 121 samples')
  await page.screenshot({ path: `${SHOTS}/picker-ephemeris-dark.png` })

  // The clock is nowhere near the file: the form says so and offers the file's own start.
  await sidebar.getByTestId('to-propagate').click()
  const targets = sidebar.getByTestId('propagate-targets')
  await expect(targets).toContainText('User ephemeris')
  await expect(targets.locator('.v-chip')).toHaveText('OEM')
  await expect(sidebar.getByTestId('hpop-options')).toHaveCount(0)
  const run = page.getByRole('button', { name: 'Propagate', exact: true })
  await expect(sidebar.getByTestId('ephemeris-no-overlap')).toContainText(name)
  await expect(run).toBeDisabled()
  await sidebar.getByTestId('use-file-span').click()
  await expect(sidebar.getByTestId('ephemeris-no-overlap')).toHaveCount(0)

  await page.getByText('1 orbit', { exact: true }).click()
  const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/propagate'))
  await run.click()
  const body = await (await response).json()
  expect(body.propagator).toBe('ephemeris')
  expect(body.force_model).toBeNull()
  expect(body.invalid).toEqual([])
  expect(body.element_set).toMatchObject({ name, norad_id: 0, age_days: null })
  expect(body.start).toBe('2026-09-16T00:00:00.000Z')
  await expect(sidebar.locator('[data-testid^="run-propagator-"]')).toHaveText('OEM')
  await expect(sidebar.getByTestId('run-experimental')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/runs-ephemeris-dark.png` })

  await openTool(page, 'Pass prediction')
  await expect(page.getByTestId('needs-elements-note')).toContainText(name)

  await page.request.delete(`/api/v1/custom-ephemerides/${body.element_set.ephemeris_id}`)
})
