import { createApp, h } from 'vue'
import { PIN_GLYPHS, type PinIcon } from '../places/pinIcons'

/** Drawn at twice the size and shown at half scale, so the marker stays sharp on HiDPI. */
export const PIN_SCALE = 0.5
/** Canvas side; the margin leaves room for the drop shadow. */
const SIZE = 60
const C = SIZE / 2
/** Badge radius: 44 px across on the canvas, 22 px on screen. */
const R = 22
const GLYPH = 26

const svgCache = new Map<PinIcon, string>()
const imageCache = new Map<string, Promise<HTMLCanvasElement>>()

/** The lucide glyph as standalone SVG markup, rendered once through a detached Vue app. */
function glyphSvg(icon: PinIcon): string {
  let svg = svgCache.get(icon)
  if (!svg) {
    const host = document.createElement('div')
    const app = createApp({
      render: () => h(PIN_GLYPHS[icon], { size: GLYPH, color: '#ffffff', strokeWidth: 2.6 }),
    })
    app.mount(host)
    svg = host.innerHTML
    app.unmount()
    if (!svg.includes('xmlns='))
      svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    svgCache.set(icon, svg)
  }
  return svg
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('pin glyph failed to load'))
    image.src = src
  })
}

/** A glyph as an image, ready for a canvas. */
function glyphImage(icon: PinIcon): Promise<HTMLImageElement> {
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(glyphSvg(icon))}`)
}

/**
 * A round badge in `color` with the icon's glyph in white, like a saved place on a web map:
 * it sits centred on the spot rather than pointing at it. Cached per icon and colour.
 */
export function pinImage(icon: PinIcon, color: string): Promise<HTMLCanvasElement> {
  const key = `${icon}|${color}`
  let pending = imageCache.get(key)
  if (!pending) {
    pending = (async () => {
      const canvas = document.createElement('canvas')
      canvas.width = SIZE
      canvas.height = SIZE
      const ctx = canvas.getContext('2d')!
      ctx.beginPath()
      ctx.arc(C, C, R, 0, Math.PI * 2)
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)'
      ctx.shadowBlur = 6
      ctx.shadowOffsetY = 2
      ctx.fillStyle = color
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.lineWidth = 4
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      const glyph = await glyphImage(icon)
      ctx.drawImage(glyph, C - GLYPH / 2, C - GLYPH / 2, GLYPH, GLYPH)
      return canvas
    })()
    pending.catch(() => imageCache.delete(key))
    imageCache.set(key, pending)
  }
  return pending
}

export interface ChipStyle {
  background: string
  text: string
  /** Outline the chip in the pin colour, for the pin the reader just picked. */
  focused: boolean
}

// Chip geometry on the 2x canvas; halve for screen pixels.
const CHIP_H = 56
const CHIP_PAD = 6
const CHIP_ICON_R = 20
const CHIP_GAP = 12
const CHIP_TEXT_PAD = 22
const CHIP_FONT = '600 26px "Pretendard Variable", sans-serif'
const STEM_H = 12
const STEM_W = 16
const DOT_R = 8
const DOT_STROKE = 4
/** Room around the drawing for the drop shadow. */
const MARGIN = 8

/** Screen pixels from the canvas bottom up to the dot centre: the billboard's anchor. */
export const CHIP_ANCHOR_PX = (MARGIN + DOT_STROKE / 2 + DOT_R) * PIN_SCALE

const chipCache = new Map<string, Promise<HTMLCanvasElement>>()

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = h / 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * A name tag for a pin: a rounded chip holding the icon in a coloured disc and the name,
 * with a short stem down to a dot on the exact spot. The chip is drawn in the theme's
 * surface colour so the name reads on any basemap. Cached per content and style.
 */
export function pinChip(
  icon: PinIcon,
  color: string,
  name: string,
  style: ChipStyle,
): Promise<HTMLCanvasElement> {
  const key = [icon, color, name, style.background, style.text, style.focused].join('|')
  let pending = chipCache.get(key)
  if (!pending) {
    pending = (async () => {
      // Measuring before the web font arrives would size the chip for the fallback font.
      await document.fonts?.load(CHIP_FONT).catch(() => undefined)
      const probe = document.createElement('canvas').getContext('2d')!
      probe.font = CHIP_FONT
      const textW = Math.ceil(probe.measureText(name).width)
      const chipW = CHIP_PAD + CHIP_ICON_R * 2 + CHIP_GAP + textW + CHIP_TEXT_PAD
      const canvas = document.createElement('canvas')
      canvas.width = chipW + MARGIN * 2
      canvas.height = MARGIN + CHIP_H + STEM_H + DOT_R * 2 + DOT_STROKE + MARGIN
      const ctx = canvas.getContext('2d')!
      const x = MARGIN
      const y = MARGIN
      const cx = x + chipW / 2

      // Chip body and stem share one shadow.
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
      ctx.shadowBlur = 8
      ctx.shadowOffsetY = 2
      ctx.fillStyle = style.background
      roundedRect(ctx, x, y, chipW, CHIP_H)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(cx - STEM_W / 2, y + CHIP_H - 1)
      ctx.lineTo(cx + STEM_W / 2, y + CHIP_H - 1)
      ctx.lineTo(cx, y + CHIP_H + STEM_H)
      ctx.closePath()
      ctx.fill()
      ctx.shadowColor = 'transparent'
      if (style.focused) {
        ctx.lineWidth = 4
        ctx.strokeStyle = color
        roundedRect(ctx, x + 2, y + 2, chipW - 4, CHIP_H - 4)
        ctx.stroke()
      }

      // Icon disc.
      const iconX = x + CHIP_PAD + CHIP_ICON_R
      const iconY = y + CHIP_H / 2
      ctx.beginPath()
      ctx.arc(iconX, iconY, CHIP_ICON_R, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      const glyph = await glyphImage(icon)
      const g = CHIP_ICON_R * 1.15
      ctx.drawImage(glyph, iconX - g / 2, iconY - g / 2, g, g)

      // Name.
      ctx.font = CHIP_FONT
      ctx.fillStyle = style.text
      ctx.textBaseline = 'middle'
      ctx.fillText(name, iconX + CHIP_ICON_R + CHIP_GAP, iconY + 1)

      // The dot marks the spot.
      const dotY = y + CHIP_H + STEM_H + DOT_R + DOT_STROKE / 2
      ctx.beginPath()
      ctx.arc(cx, dotY, DOT_R, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.lineWidth = DOT_STROKE
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      return canvas
    })()
    pending.catch(() => chipCache.delete(key))
    chipCache.set(key, pending)
  }
  return pending
}
