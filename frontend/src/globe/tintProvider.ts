import {
  Event,
  GeographicTilingScheme,
  Rectangle,
  type Credit,
  type ImageryProvider,
  type Proxy,
  type TileDiscardPolicy,
} from 'cesium'
import type { Bbox } from '../places/camera'
import { overlaps, tileBbox, type IndexedRing } from '../places/tint'

const TILE_PX = 256
/** Past this level Cesium upsamples; a 1:50m outline has no more detail to give. */
const MAX_LEVEL = 12

/** One area to paint: rings filled even-odd, each part optional. */
export interface TintShape {
  rings: IndexedRing[]
  bbox: Bbox
  fill: string | null
  stroke: string | null
  /**
   * Open lines to stroke instead of the ring outlines, when the rings carry edges that are
   * not real boundaries (a ring closed through a pole).
   */
  lines?: IndexedRing[]
  /** Fill opacity of this shape alone, in place of the provider's shared one. */
  fillOpacity?: number
  /** Outline width in tile pixels; country borders stay hairline by default. */
  strokeWidth?: number
}

type Ctx = CanvasRenderingContext2D

/** Add a flat `[lon, lat, ...]` line to the current path in tile pixels. */
function trace(
  ctx: Ctx,
  ring: readonly number[],
  west: number,
  north: number,
  sx: number,
  sy: number,
) {
  ctx.moveTo((ring[0]! - west) * sx, (north - ring[1]!) * sy)
  for (let i = 2; i + 1 < ring.length; i += 2) {
    ctx.lineTo((ring[i]! - west) * sx, (north - ring[i + 1]!) * sy)
  }
}

/**
 * An imagery provider that paints polygons into each tile on request: the country tint and
 * the pass visibility areas.
 *
 * Drawn as imagery, a tint drapes over the globe like the basemap: the far side of the
 * Earth hides it, 2D and 3D look the same, and outlines stay crisp when zoomed in because
 * every tile is drawn from the vectors. Follows the shape of Cesium's GridImageryProvider.
 *
 * Tiles are painted once. A layer whose shapes move (the night side) swaps them with
 * `setShapes` and calls `reload`, which repaints the tiles in place.
 */
export class TintProvider {
  readonly tilingScheme = new GeographicTilingScheme()
  readonly rectangle: Rectangle = this.tilingScheme.rectangle
  readonly tileWidth = TILE_PX
  readonly tileHeight = TILE_PX
  readonly minimumLevel = 0
  readonly maximumLevel: number
  readonly tileDiscardPolicy: TileDiscardPolicy | undefined = undefined
  readonly errorEvent = new Event()
  readonly credit: Credit | undefined = undefined
  readonly proxy: Proxy | undefined = undefined
  readonly hasAlphaChannel = true
  /**
   * Set by Cesium while the provider is in a layer (as for its time-dynamic WMS and WMTS
   * providers): reloads every tile, keeping the old picture until the new one is ready.
   */
  _reload: (() => void) | undefined = undefined

  constructor(
    private shapes: readonly TintShape[],
    /** Fill opacity shared by every shape; strokes are opaque. */
    private readonly fillOpacity: number,
    /** Deepest level painted from the vectors; Cesium upsamples past it. */
    maximumLevel = MAX_LEVEL,
  ) {
    this.maximumLevel = maximumLevel
  }

  /** Replace the shapes; tiles already painted keep the old ones until `reload`. */
  setShapes(shapes: readonly TintShape[]) {
    this.shapes = shapes
  }

  /** Repaint every tile from the current shapes. False when Cesium offers no way to. */
  reload(): boolean {
    if (!this._reload) return false
    this._reload()
    return true
  }

  getTileCredits(): Credit[] {
    return []
  }

  requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement> {
    const canvas = document.createElement('canvas')
    canvas.width = TILE_PX
    canvas.height = TILE_PX
    const ctx = canvas.getContext('2d')
    if (!ctx) return Promise.resolve(canvas)
    const tile = tileBbox(x, y, level)
    const [west, south, east, north] = tile
    const sx = TILE_PX / (east - west)
    const sy = TILE_PX / (north - south)
    ctx.lineJoin = 'round'
    const baseWidth = level >= 6 ? 1.5 : 1

    for (const shape of this.shapes) {
      if (!overlaps(shape.bbox, tile)) continue
      ctx.beginPath()
      let any = false
      for (const { ring, bbox } of shape.rings) {
        if (!overlaps(bbox, tile)) continue
        any = true
        trace(ctx, ring, west, north, sx, sy)
        ctx.closePath()
      }
      if (!any) continue
      const fillOpacity = shape.fillOpacity ?? this.fillOpacity
      if (shape.fill && fillOpacity > 0) {
        ctx.globalAlpha = fillOpacity
        ctx.fillStyle = shape.fill
        ctx.fill('evenodd')
        ctx.globalAlpha = 1
      }
      if (shape.stroke) {
        ctx.lineWidth = shape.strokeWidth ?? baseWidth
        ctx.strokeStyle = shape.stroke
        if (shape.lines) {
          ctx.beginPath()
          for (const line of shape.lines) {
            if (overlaps(line.bbox, tile)) trace(ctx, line.ring, west, north, sx, sy)
          }
        }
        ctx.stroke()
      }
    }
    return Promise.resolve(canvas)
  }

  pickFeatures(): undefined {
    return undefined
  }
}

/** The provider typed as Cesium expects; it implements the interface structurally. */
export function createTintProvider(
  shapes: readonly TintShape[],
  fillOpacity: number,
): ImageryProvider {
  return new TintProvider(shapes, fillOpacity) as unknown as ImageryProvider
}
