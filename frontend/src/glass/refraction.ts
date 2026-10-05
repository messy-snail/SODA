/**
 * Edge refraction for liquid-glass panels: an SVG displacement filter used as a
 * `backdrop-filter`, so the backdrop bends near a pane's rim like light through a thick
 * rounded slab. Only Chromium applies SVG filters to the backdrop; elsewhere panes keep
 * the plain CSS blur.
 *
 * The map and the filter markup are pure so vitest can check them.
 */

export interface LensOptions {
  /** Corner radius in CSS px. */
  radius: number
  /** Width of the curved rim in CSS px; the flat middle does not bend. */
  bezel: number
}

/**
 * RGBA displacement map for a rounded rectangle of `width`×`height` CSS px.
 *
 * Red and green carry the x and y offset around 128. Inside the rim the offset points
 * inward, growing towards the edge, so each rim pixel shows backdrop from further in: the
 * edge magnifies and bends what is behind it, as a convex lens would.
 */
export function displacementMap(
  width: number,
  height: number,
  lens: LensOptions,
): Uint8ClampedArray<ArrayBuffer> {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const r = Math.min(lens.radius, w / 2, h / 2)
  const bezel = Math.max(1, lens.bezel)
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const py = y + 0.5
    for (let x = 0; x < w; x++) {
      const px = x + 0.5
      // Distance in from the rounded edge, and the outward normal there.
      let depth: number
      let nx = 0
      let ny = 0
      const cx = px < r ? r : px > w - r ? w - r : px
      const cy = py < r ? r : py > h - r ? h - r : py
      if (cx !== px && cy !== py) {
        const dx = px - cx
        const dy = py - cy
        const length = Math.hypot(dx, dy) || 1
        depth = r - length
        nx = dx / length
        ny = dy / length
      } else {
        const edges = [px, w - px, py, h - py]
        depth = Math.min(...edges)
        const side = edges.indexOf(depth)
        if (side === 0) nx = -1
        else if (side === 1) nx = 1
        else if (side === 2) ny = -1
        else ny = 1
      }
      const i = (y * w + x) * 4
      let strength = 0
      if (depth >= 0 && depth < bezel) {
        const t = 1 - depth / bezel
        strength = t * t
      }
      data[i] = 128 - nx * strength * 127
      data[i + 1] = 128 - ny * strength * 127
      data[i + 2] = 128
      data[i + 3] = 255
    }
  }
  return data
}

export interface FilterOptions {
  /** Backdrop blur, CSS px. */
  blur: number
  /** Rim displacement at full strength, CSS px. */
  scale: number
  /** Extra spread between the colour channels at the rim (0 = none). */
  dispersion: number
  saturate: number
  /** Tone applied after the blur: `out = slope·in + intercept` per channel. */
  slope: number
  intercept: number
}

/** `<filter>` markup for one pane; `map` is the displacement map as an image URL. */
export function filterMarkup(
  id: string,
  width: number,
  height: number,
  map: string,
  options: FilterOptions,
): string {
  const w = Math.round(width)
  const h = Math.round(height)
  const channel = (name: string, index: number, factor: number) => {
    const rows = ['0 0 0 0 0', '0 0 0 0 0', '0 0 0 0 0', '0 0 0 1 0']
    rows[index] = ['1 0 0 0 0', '0 1 0 0 0', '0 0 1 0 0'][index]!
    return (
      `<feDisplacementMap in="blur" in2="map" scale="${(options.scale * factor).toFixed(1)}" ` +
      `xChannelSelector="R" yChannelSelector="G" result="d${name}"/>` +
      `<feColorMatrix in="d${name}" type="matrix" values="${rows.join(' ')}" result="${name}"/>`
    )
  }
  const tone = `slope="${options.slope}" intercept="${options.intercept}"`
  return (
    `<filter id="${id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" ` +
    `primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${options.blur / 2}" edgeMode="duplicate" result="blur"/>` +
    `<feImage href="${map}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>` +
    channel('r', 0, 1 + options.dispersion) +
    channel('g', 1, 1) +
    channel('b', 2, 1 - options.dispersion) +
    `<feComposite in="r" in2="g" operator="arithmetic" k2="1" k3="1" result="rg"/>` +
    `<feComposite in="rg" in2="b" operator="arithmetic" k2="1" k3="1" result="rgb"/>` +
    `<feColorMatrix in="rgb" type="saturate" values="${options.saturate}" result="sat"/>` +
    `<feComponentTransfer in="sat"><feFuncR type="linear" ${tone}/>` +
    `<feFuncG type="linear" ${tone}/><feFuncB type="linear" ${tone}/></feComponentTransfer>` +
    `</filter>`
  )
}

/** Whether this browser applies SVG filters to the backdrop (Chromium: Chrome, Edge, Whale). */
export function supportsRefraction(): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } })
    .userAgentData?.brands
  const chromium = brands
    ? brands.some((entry) => entry.brand === 'Chromium')
    : /Chrome\//.test(navigator.userAgent)
  return chromium && CSS.supports('backdrop-filter', 'url(#a)')
}
