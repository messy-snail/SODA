import type { Viewer } from 'cesium'
import { watch } from 'vue'
import { displacementMap, filterMarkup, supportsRefraction } from '../glass/refraction'
import {
  DARK_DIM,
  glassAlpha,
  glassTone,
  gridRect,
  hexLuminance,
  LIGHT_LIFT,
  regionLuminance,
  type GlassMaterial,
} from '../glass/tint'
import { useAppearanceStore } from '../stores/appearance'
import { presets, type ThemePreset } from '../theme/presets'
import { useThemePreset } from '../theme/useThemePreset'

/** Panes that get an adaptive tint; only `.glass` panes also bend the backdrop. */
const TINTED = '.glass, .glass-chip, .cesium-viewer-bottom'
/** Small controls: `clear` material, which turns to dark glass over a dark backdrop. */
const CLEAR = '.glass--clear, .glass-chip, .cesium-viewer-bottom'
/** What a light-theme control borrows while it is dark glass. */
const DARK_PARTNER: ThemePreset = presets.find((preset) => preset.id === 'sodaDark')!
/** The globe keeps moving under the panes, but tint only needs to follow slowly. */
const SAMPLE_MS = 400
/** Sampling grid laid over the globe canvas; one cell is about 16×16 CSS px. */
const GRID_W = 100
const GRID_H = 60
/** Width of the curved rim that bends the backdrop; the corner radius comes from each pane. */
const BEZEL = 16
const SVG_NS = 'http://www.w3.org/2000/svg'

interface Lens {
  id: string
  width: number
  height: number
  radius: number
  dark: boolean
}

function rgbTriplet(hex: string): string {
  const value = Number.parseInt(hex.replace('#', '').slice(0, 6), 16)
  return `${(value >> 16) & 255},${(value >> 8) & 255},${value & 255}`
}

/**
 * Colours a light-theme control borrows from the dark partner while it is dark glass.
 * Vuetify re-declares its colour variables on every component that carries a
 * `v-theme--*` class, so the override has to reach those descendants too, not just the
 * control; the doubled attribute outranks Vuetify's single-class rule.
 */
function borrowedColours(): string {
  const body = Object.entries(DARK_PARTNER.colors)
    .map(([name, hex]) => `--v-theme-${name}: ${rgbTriplet(hex)};`)
    .join(' ')
  const self = '[data-glass-borrow][data-glass-borrow]'
  return `${self}, ${self} [class*='v-theme--'] { ${body} --v-border-color: 255, 255, 255; }`
}

function setTone(element: HTMLElement, tone: 'light' | 'dark', themeDark: boolean) {
  element.dataset.glassTone = tone
  if (tone === 'dark' && !themeDark) element.dataset.glassBorrow = ''
  else delete element.dataset.glassBorrow
}

/**
 * Liquid glass over the globe: each pane's tint follows what is behind it, and (Chromium
 * only) the backdrop bends at the pane's rim.
 *
 * Every `SAMPLE_MS`, right after Cesium renders, the canvas is shrunk to a small grid and
 * each pane reads the luminance of the cells it covers. Panes outside the canvas keep the
 * theme default from `styles.css`.
 */
export function useLiquidGlass(viewer: Viewer) {
  const appearance = useAppearanceStore()
  const theme = useThemePreset()
  const refractionSupported = supportsRefraction()
  const grid = document.createElement('canvas')
  grid.width = GRID_W
  grid.height = GRID_H
  const context = grid.getContext('2d')
  const colours = document.createElement('style')
  colours.textContent = borrowedColours()
  document.head.appendChild(colours)
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.position = 'absolute'
  document.body.appendChild(svg)
  const lenses = new WeakMap<HTMLElement, Lens>()
  const bent = new Set<HTMLElement>()
  let counter = 0
  let lastSample = 0

  function surfaceLuminance() {
    return hexLuminance(theme.preset.colors.surface ?? (theme.preset.dark ? '#1c2633' : '#ffffff'))
  }

  function sample() {
    if (!context) return
    const canvas = viewer.scene.canvas
    const box = canvas.getBoundingClientRect()
    // Must run in postRender: the WebGL buffer is only valid until the frame is composited.
    context.drawImage(canvas, 0, 0, GRID_W, GRID_H)
    const pixels = context.getImageData(0, 0, GRID_W, GRID_H).data
    const themeDark = theme.preset.dark
    const themeSurface = surfaceLuminance()
    const partnerSurface = hexLuminance(DARK_PARTNER.colors.surface ?? '#1c2633')
    for (const element of document.querySelectorAll<HTMLElement>(TINTED)) {
      const region = gridRect(element.getBoundingClientRect(), box, GRID_W, GRID_H)
      if (!region) {
        element.style.removeProperty('--lg-alpha')
        setTone(element, themeDark ? 'dark' : 'light', themeDark)
        continue
      }
      const material: GlassMaterial = element.matches(CLEAR) ? 'clear' : 'regular'
      const current = element.dataset.glassTone === 'dark' ? 'dark' : 'light'
      const median = regionLuminance(pixels, GRID_W, region, 0.5)
      const tone = glassTone(median, current, themeDark, material)
      setTone(element, tone, themeDark)
      const dark = tone === 'dark'
      // The worst spot decides: the darkest for dark text, the brightest for light text.
      const backdrop = regionLuminance(pixels, GRID_W, region, dark ? 0.92 : 0.08)
      const surface = dark && !themeDark ? partnerSurface : themeSurface
      const alpha = glassAlpha(backdrop, dark, surface, appearance.intensity, material)
      element.style.setProperty('--lg-alpha', alpha.toFixed(3))
    }
  }

  function unbend(element: HTMLElement) {
    element.style.removeProperty('backdrop-filter')
    const lens = lenses.get(element)
    if (lens) svg.querySelector(`#${lens.id}`)?.remove()
    lenses.delete(element)
    bent.delete(element)
  }

  function bend() {
    const active = refractionSupported && appearance.glass && appearance.refraction
    for (const element of [...bent]) {
      if (!active || !element.isConnected) unbend(element)
    }
    if (!active) return
    for (const element of document.querySelectorAll<HTMLElement>('.glass')) {
      const dark = element.dataset.glassTone === 'dark' || theme.preset.dark
      const width = Math.round(element.offsetWidth)
      const height = Math.round(element.offsetHeight)
      if (width < 24 || height < 24) continue
      // Cards are rounded; the frame (header, rail, side bar) is square.
      const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
      const lens = lenses.get(element)
      if (
        lens &&
        lens.width === width &&
        lens.height === height &&
        lens.radius === radius &&
        lens.dark === dark
      ) {
        continue
      }
      const id = lens?.id ?? `soda-lens-${++counter}`
      svg.querySelector(`#${id}`)?.remove()
      const map = document.createElement('canvas')
      map.width = width
      map.height = height
      const pixels = displacementMap(width, height, { radius, bezel: BEZEL })
      map.getContext('2d')?.putImageData(new ImageData(pixels, width, height), 0, 0)
      const markup = filterMarkup(id, width, height, map.toDataURL(), {
        blur: 10,
        scale: 46,
        dispersion: 0.12,
        saturate: 1.7,
        // Light glass lifts the backdrop (it scatters), dark glass dims it.
        // Must match LIGHT_LIFT / DARK_DIM in glass/tint.ts, which the tint is solved for.
        slope: dark ? DARK_DIM : 1 - LIGHT_LIFT,
        intercept: dark ? 0 : LIGHT_LIFT,
      })
      svg.insertAdjacentHTML('beforeend', markup)
      element.style.setProperty('backdrop-filter', `url(#${id})`)
      lenses.set(element, { id, width, height, radius, dark })
      bent.add(element)
    }
  }

  const removeListener = viewer.scene.postRender.addEventListener(() => {
    const now = performance.now()
    if (now - lastSample < SAMPLE_MS) return
    lastSample = now
    sample()
    bend()
  })

  watch(
    () => [appearance.glass, appearance.refraction, theme.preset.id],
    () => {
      lastSample = 0
    },
  )

  return {
    refractionSupported,
    dispose() {
      removeListener()
      for (const element of [...bent]) unbend(element)
      for (const element of document.querySelectorAll<HTMLElement>(TINTED)) {
        element.style.removeProperty('--lg-alpha')
        setTone(element, 'light', true)
        delete element.dataset.glassTone
      }
      svg.remove()
      colours.remove()
    },
  }
}
