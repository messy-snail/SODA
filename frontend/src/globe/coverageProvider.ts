import {
  Event,
  GeographicTilingScheme,
  Rectangle,
  type Credit,
  type ImageryProvider,
  type Proxy,
  type TileDiscardPolicy,
} from 'cesium'
import type { Grid } from '../mission/coverage'
import { boxWidthDeg } from '../mission/targets'
import { tileBbox } from '../places/tint'

const TILE_PX = 256
/** Past this level Cesium upsamples; a cell is far larger than a tile long before it. */
const MAX_LEVEL = 12

/**
 * An imagery provider that drapes a grid of coloured cells over a box: the coverage map.
 *
 * The grid is one small picture with a pixel per cell (north row first). Every tile copies
 * the part of it that falls inside, unsmoothed, so cells keep hard edges at any zoom, have
 * no seams between them, and look the same in 2D and 3D. Follows `TintProvider`.
 */
export class CoverageProvider {
  readonly tilingScheme = new GeographicTilingScheme()
  readonly rectangle: Rectangle = this.tilingScheme.rectangle
  readonly tileWidth = TILE_PX
  readonly tileHeight = TILE_PX
  readonly minimumLevel = 0
  readonly maximumLevel = MAX_LEVEL
  readonly tileDiscardPolicy: TileDiscardPolicy | undefined = undefined
  readonly errorEvent = new Event()
  readonly credit: Credit | undefined = undefined
  readonly proxy: Proxy | undefined = undefined
  readonly hasAlphaChannel = true
  /** Set by Cesium while the provider is in a layer; see `TintProvider._reload`. */
  _reload: (() => void) | undefined = undefined

  constructor(
    readonly grid: Grid,
    private cells: CanvasImageSource,
  ) {}

  /** Replace the picture; tiles already painted keep the old one until `reload`. */
  setCells(cells: CanvasImageSource) {
    this.cells = cells
  }

  /** Repaint every tile from the current picture. False when Cesium offers no way to. */
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
    ctx.imageSmoothingEnabled = false
    const [tileWest, tileSouth, tileEast, tileNorth] = tileBbox(x, y, level)
    const { grid } = this
    const width = boxWidthDeg(grid)
    const height = grid.north_deg - grid.south_deg
    const south = Math.max(tileSouth, grid.south_deg)
    const north = Math.min(tileNorth, grid.north_deg)
    if (north <= south || width <= 0) return Promise.resolve(canvas)
    const perLon = TILE_PX / (tileEast - tileWest)
    const perLat = TILE_PX / (tileNorth - tileSouth)
    // A box across the date line reaches a tile from the west or, a turn later, the east.
    for (const turn of [-360, 0, 360]) {
      const boxWest = grid.west_deg + turn
      const west = Math.max(tileWest, boxWest)
      const east = Math.min(tileEast, boxWest + width)
      if (east <= west) continue
      ctx.drawImage(
        this.cells,
        ((west - boxWest) / width) * grid.nx,
        ((grid.north_deg - north) / height) * grid.ny,
        ((east - west) / width) * grid.nx,
        ((north - south) / height) * grid.ny,
        (west - tileWest) * perLon,
        (tileNorth - north) * perLat,
        (east - west) * perLon,
        (north - south) * perLat,
      )
    }
    return Promise.resolve(canvas)
  }

  pickFeatures(): undefined {
    return undefined
  }
}

/** The provider typed as Cesium expects; it implements the interface structurally. */
export function asImageryProvider(provider: CoverageProvider): ImageryProvider {
  return provider as unknown as ImageryProvider
}
