import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { expect, test as base, type Locator, type Page } from '@playwright/test'
import type { Viewer } from 'cesium'
import { openSatelliteStep } from '../tests/rail'

/** Where the recorded frames go; `scripts/build_readme_media.py` reads it. */
const OUT = '../.cache/demo-videos'

/** Every how many compositor frames one is kept; 2 is about 30 a second. */
const SKIP = 2

export const BLUEBON = 'norad:62688'
export const KOMPSAT_3A = 'norad:40536'

type SodaWindow = Window & { __sodaViewer?: Viewer }

interface Scene {
  /** Starts the clip. Everything before it is setup and is not recorded. */
  action(): Promise<void>
}

/**
 * A recorded page has no mouse pointer, so one is drawn: a dot that follows the real mouse
 * events and a ring on every press. It lives only in the recording, never in the app.
 */
function drawPointer() {
  const install = () => {
    const dot = document.createElement('div')
    dot.style.cssText =
      'position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
      'background:rgba(255,255,255,.85);border:2px solid rgba(8,36,75,.9);pointer-events:none;' +
      'z-index:2147483647;transform:translate(-100px,-100px);box-shadow:0 1px 6px rgba(0,0,0,.5)'
    document.documentElement.appendChild(dot)
    const place = (event: MouseEvent) => {
      dot.style.transform = `translate(${event.clientX}px,${event.clientY}px)`
    }
    document.addEventListener('mousemove', place, true)
    document.addEventListener(
      'mousedown',
      (event) => {
        place(event)
        const ring = document.createElement('div')
        ring.style.cssText =
          'position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
          'border:2px solid rgba(255,255,255,.9);pointer-events:none;z-index:2147483646;' +
          `transform:translate(${event.clientX}px,${event.clientY}px) scale(1);opacity:1;` +
          'transition:transform .45s ease-out,opacity .45s ease-out'
        document.documentElement.appendChild(ring)
        requestAnimationFrame(() => {
          ring.style.transform = `translate(${event.clientX}px,${event.clientY}px) scale(3)`
          ring.style.opacity = '0'
        })
        setTimeout(() => ring.remove(), 500)
      },
      true,
    )
  }
  if (document.documentElement) install()
  else document.addEventListener('DOMContentLoaded', install)
}

/**
 * One clip per test, saved under the test's title as lossless frames plus an ffmpeg concat
 * list with their real timing. The frames come from the DevTools screencast rather than
 * Playwright's video: that one is lossy VP8, whose noise makes every frame differ from the
 * last and a GIF of a still globe tens of megabytes large.
 */
export const test = base.extend<{ scene: Scene }>({
  scene: async ({ page }, use, testInfo) => {
    const folder = `${OUT}/${testInfo.title}`
    rmSync(folder, { recursive: true, force: true })
    mkdirSync(folder, { recursive: true })
    await page.addInitScript(drawPointer)
    const session = await page.context().newCDPSession(page)
    const stamps: number[] = []
    session.on('Page.screencastFrame', (frame) => {
      const index = stamps.push(frame.metadata.timestamp ?? Date.now() / 1000) - 1
      writeFileSync(`${folder}/${String(index).padStart(5, '0')}.png`, frame.data, 'base64')
      void session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
    })
    await use({
      async action() {
        await session.send('Page.startScreencast', { format: 'png', everyNthFrame: SKIP })
      },
    })
    await session.send('Page.stopScreencast')
    const lines = ['ffconcat version 1.0']
    stamps.forEach((stamp, index) => {
      const next = stamps[index + 1] ?? stamp + 1.5
      lines.push(
        `file '${String(index).padStart(5, '0')}.png'`,
        `duration ${(next - stamp).toFixed(4)}`,
      )
    })
    // The concat demuxer drops the last duration unless the last file is named twice.
    if (stamps.length) lines.push(`file '${String(stamps.length - 1).padStart(5, '0')}.png'`)
    writeFileSync(`${folder}/frames.txt`, `${lines.join('\n')}\n`)
  },
})

interface Look {
  /** The cloud of every catalogued satellite. Off by default: thousands of moving dots
   * change every pixel of every frame, which a GIF cannot compress. */
  cloud?: boolean
  /** Day and night shading. Off by default so the Earth reads well at any time. */
  lighting?: boolean
}

/** Opens the app in English and waits until the globe and the catalogue are there. */
export async function boot(page: Page, look: Look = {}) {
  await page.addInitScript((prefs) => localStorage.setItem('soda.layers', JSON.stringify(prefs)), {
    version: 1,
    showSatellites: look.cloud ?? false,
    lighting: look.lighting ?? false,
    markerStyle: { shape: 'cube', size_m: 5, minimum_size_px: 64 },
  })
  await page.goto('/?e2e&lang=en')
  await page.waitForFunction(() => Boolean((window as SodaWindow).__sodaViewer))
  await expect(page.locator('#boot')).toBeHidden()
  await expect(page.getByText(/CelesTrak ·/)).toBeVisible()
  // Stars, Sun and Moon drift with the clock and the atmosphere follows the Sun. Each is a
  // faint change over the whole frame, which costs a GIF more than everything that matters.
  await page.evaluate(() => {
    const scene = (window as SodaWindow).__sodaViewer!.scene
    if (scene.skyBox) scene.skyBox.show = false
    if (scene.sun) scene.sun.show = false
    if (scene.moon) scene.moon.show = false
    scene.globe.dynamicAtmosphereLighting = false
  })
}

/** Folds the sidebar away so the globe has the whole frame. */
export async function foldSidebar(page: Page) {
  const open = page.locator('button[aria-pressed="true"]', {
    hasText: /^(Orbit|Swath|Passes|Imaging|Storage|Power|TC\/TM|View)$/,
  })
  if (await open.count()) await open.first().click()
}

export function hold(page: Page, ms: number) {
  return page.waitForTimeout(ms)
}

/** Glides the pointer to the element, pauses long enough to be read, then clicks it. */
export async function click(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 })
    await hold(page, 250)
  }
  await target.click()
  await hold(page, 450)
}

/** Glides to a point of the page and clicks there (for the globe canvas). */
export async function clickAt(page: Page, x: number, y: number) {
  await page.mouse.move(x, y, { steps: 24 })
  await hold(page, 250)
  await page.mouse.click(x, y)
  await hold(page, 450)
}

/** Opens a rail tool with the pointer, unless it is open already. */
export async function tool(page: Page, label: string) {
  const button = page.getByRole('button', { name: label, exact: true })
  if ((await button.getAttribute('aria-pressed')) !== 'true') await click(page, button)
}

/** Longitude and latitude (degrees) under the first propagated satellite right now. */
export async function subpoint(page: Page) {
  return page.evaluate(() => {
    const viewer = (window as SodaWindow).__sodaViewer!
    const marker = viewer.entities.values.find((entity) => entity.id.startsWith('marker:'))
    const at = marker!.position!.getValue(viewer.clock.currentTime)!
    const degrees = 180 / Math.PI
    return {
      lon: Math.atan2(at.y, at.x) * degrees,
      lat: Math.atan2(at.z, Math.hypot(at.x, at.y)) * degrees,
    }
  })
}

/** Types into a field at a pace the eye can follow. */
export async function type(page: Page, field: Locator, text: string) {
  await click(page, field)
  await field.fill('')
  await field.pressSequentially(text, { delay: 70 })
  await hold(page, 300)
}

/** Picks the satellites by search and propagates them together, without any pauses. */
export async function propagate(page: Page, picks: { key: string; query: string }[], span: string) {
  const sidebar = page.getByTestId('tool-sidebar')
  await openSatelliteStep(page, 'pick')
  for (const pick of picks) {
    await sidebar.getByTestId('satellite-query').locator('input').fill(pick.query)
    await sidebar.getByTestId(`satellite-row-${pick.key}`).click()
  }
  await sidebar.getByTestId('to-propagate').click()
  await page.getByText(span, { exact: true }).click()
  await page.getByRole('button', { name: 'Propagate', exact: true }).click()
  await expect(page.getByTestId('satellite-step-runs')).toContainText(String(picks.length))
}

/** Runs the simulation clock at `multiplier` times real time, or stops it at 0. */
export async function play(page: Page, multiplier: number) {
  await page.evaluate((speed) => {
    const clock = (window as SodaWindow).__sodaViewer!.clock
    if (speed) clock.multiplier = speed
    clock.shouldAnimate = speed !== 0
  }, multiplier)
}

/** Turns the camera around the Earth at `radPerSecond`, or stops it at 0. */
export async function spin(page: Page, radPerSecond: number) {
  await page.evaluate((rate) => {
    const host = window as SodaWindow & { __demoSpin?: () => void }
    host.__demoSpin?.()
    host.__demoSpin = undefined
    if (!rate) return
    const viewer = host.__sodaViewer!
    let last = performance.now()
    host.__demoSpin = viewer.scene.preRender.addEventListener(() => {
      const now = performance.now()
      viewer.camera.rotateRight((rate * (now - last)) / 1000)
      last = now
    })
  }, radPerSecond)
}

/** Moves the camera above a point over `seconds`, looking straight down. */
export async function flyTo(
  page: Page,
  lonDeg: number,
  latDeg: number,
  heightM: number,
  seconds = 2,
) {
  await page.evaluate(
    ([lon, lat, height, duration]) => {
      const viewer = (window as SodaWindow).__sodaViewer!
      const ellipsoid = viewer.scene.globe.ellipsoid
      const radians = Math.PI / 180
      viewer.camera.flyTo({
        destination: ellipsoid.cartographicToCartesian({
          longitude: lon * radians,
          latitude: lat * radians,
          height,
        } as never),
        duration,
      })
    },
    [lonDeg, latDeg, heightM, seconds],
  )
  await hold(page, seconds * 1000 + 300)
}

export { expect }
