import { Color, ImageryLayer, Rectangle, type Entity, type Viewer } from 'cesium'
import { watch } from 'vue'
import { cellCentre, rampColor, type Grid } from '../mission/coverage'
import { boxWidthDeg, wrapLon } from '../mission/targets'
import { useCoverageStore } from '../stores/coverage'
import { useThemePreset } from '../theme/useThemePreset'
import { asImageryProvider, CoverageProvider } from './coverageProvider'
import { addOrdered, IMAGERY_BAND } from './imageryOrder'

const SELECTED_ID = 'coverage-cell'

/**
 * The coverage map of the imaging tool: the chosen metric of every cell, draped over the
 * box as imagery, with the picked cell outlined.
 *
 * The layer exists only while a result is showing, so a globe without one has exactly the
 * imagery layers it had before.
 */
export function useCoverageLayer(viewer: Viewer) {
  const coverage = useCoverageStore()
  const theme = useThemePreset()
  let layer: ImageryLayer | null = null
  let provider: CoverageProvider | null = null
  let outline: Entity | null = null

  function remove() {
    if (layer && viewer.imageryLayers.contains(layer)) viewer.imageryLayers.remove(layer)
    layer = null
    provider = null
  }

  /** One pixel per cell, north row first. */
  function paint(grid: Grid): HTMLCanvasElement | null {
    const all = coverage.values
    const canvas = document.createElement('canvas')
    canvas.width = grid.nx
    canvas.height = grid.ny
    const ctx = canvas.getContext('2d')
    if (!all || !ctx) return null
    const { ramp, empty } = theme.preset.globe.coverage
    const blank = rampColor(0, [empty, empty])
    const values = all[coverage.settings.metric]
    const range = coverage.range
    const span = range ? range.max - range.min : 0
    const image = ctx.createImageData(grid.nx, grid.ny)
    for (let row = 0; row < grid.ny; row++) {
      for (let column = 0; column < grid.nx; column++) {
        const cell = row * grid.nx + column
        const value = values[cell]!
        const valued = range !== null && all.count[cell]! > 0 && !Number.isNaN(value)
        // A single value has nowhere to sit on the ramp but its top.
        const [r, g, b] = valued
          ? rampColor(span > 0 ? (value - range.min) / span : 1, ramp)
          : blank
        const at = ((grid.ny - 1 - row) * grid.nx + column) * 4
        image.data.set([r, g, b, 255], at)
      }
    }
    ctx.putImageData(image, 0, 0)
    return canvas
  }

  function drawSelected(grid: Grid | null) {
    if (outline) viewer.entities.remove(outline)
    outline = null
    const cell = coverage.selectedCell
    if (!grid || cell === null) return
    const centre = cellCentre(grid, cell)
    const halfLon = boxWidthDeg(grid) / grid.nx / 2
    const halfLat = (grid.north_deg - grid.south_deg) / grid.ny / 2
    outline = viewer.entities.add({
      id: SELECTED_ID,
      rectangle: {
        coordinates: Rectangle.fromDegrees(
          wrapLon(centre.lon_deg - halfLon),
          centre.lat_deg - halfLat,
          wrapLon(centre.lon_deg + halfLon),
          centre.lat_deg + halfLat,
        ),
        fill: false,
        outline: true,
        outlineColor: Color.fromCssColorString(theme.preset.globe.chipText),
        outlineWidth: 2,
        height: 0,
      },
    })
  }

  function render() {
    if (viewer.isDestroyed()) return
    const grid = coverage.shown ? (coverage.result?.grid ?? null) : null
    const cells = grid ? paint(grid) : null
    drawSelected(cells ? grid : null)
    if (!grid || !cells) {
      remove()
      return
    }
    // Same grid, new numbers: repaint the tiles in place rather than flash a new layer.
    if (provider && provider.grid === grid) {
      provider.setCells(cells)
      if (provider.reload()) return
    }
    remove()
    provider = new CoverageProvider(grid, cells)
    layer = addOrdered(viewer, new ImageryLayer(asImageryProvider(provider)), IMAGERY_BAND.coverage)
    layer.alpha = theme.preset.globe.coverage.opacity
  }

  const stop = watch(
    () => [
      coverage.shown,
      coverage.result,
      coverage.values,
      coverage.settings.metric,
      coverage.selectedCell,
      theme.preset,
    ],
    render,
    { immediate: true },
  )

  return {
    dispose() {
      stop()
      if (outline && !viewer.isDestroyed()) viewer.entities.remove(outline)
      if (!viewer.isDestroyed()) remove()
    },
  }
}
