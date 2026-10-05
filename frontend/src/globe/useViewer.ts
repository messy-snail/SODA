import {
  Cartesian3,
  Color,
  EllipsoidTerrainProvider,
  Ion,
  JulianDate,
  SceneMode,
  TimeInterval,
  Transforms,
  Viewer,
} from 'cesium'
import { homeDestination, type CameraPoint } from '../places/camera'

const toCartesian = (point: CameraPoint) =>
  Cartesian3.fromDegrees(point.lon_deg, point.lat_deg, point.height_m)

/** Build the viewer with the camera already at `home` (the 3D home view). */
export function createViewer(container: HTMLElement, home: CameraPoint): Viewer {
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN
  if (token) Ion.defaultAccessToken = token

  const viewer = new Viewer(container, {
    animation: false,
    timeline: false,
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    terrainProvider: new EllipsoidTerrainProvider(),
    shouldAnimate: true,
  })
  const { scene } = viewer
  scene.globe.baseColor = Color.fromCssColorString('#0b1a2e')
  scene.globe.enableLighting = true
  scene.globe.showGroundAtmosphere = true
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true
  scene.screenSpaceCameraController.minimumZoomDistance = 200
  scene.screenSpaceCameraController.maximumZoomDistance = 250_000_000
  viewer.camera.setView({ destination: toCartesian(home) })
  return viewer
}

/** Load Earth orientation data for the inertial (ICRF) camera transform. */
export async function preloadInertialFrame(startMs: number, stopMs: number): Promise<void> {
  const interval = new TimeInterval({
    start: JulianDate.fromDate(new Date(startMs)),
    stop: JulianDate.fromDate(new Date(stopMs)),
  })
  await Transforms.preloadIcrfFixed(interval)
}

/** Fly to the home view of the current scene mode; `duration` 0 jumps there. */
export function flyHome(viewer: Viewer, home: CameraPoint, duration = 1.5) {
  const mode = viewer.scene.mode === SceneMode.SCENE2D ? '2d' : '3d'
  const destination = toCartesian(homeDestination(home, mode))
  if (duration > 0) viewer.camera.flyTo({ destination, duration })
  else viewer.camera.setView({ destination })
}

/** Reset Cesium's failed-download cache so an explicit frame retry can fetch XYS data again. */
export function resetInertialFrameCache(): void {
  // Cesium 1.145 exposes this at runtime but omits it from its public TypeScript declarations.
  // Keep this compatibility bridge here; the browser test exercises failure followed by retry.
  interface XysData {
    constructor: new () => XysData
  }
  const transforms = Transforms as unknown as { iau2006XysData: XysData }
  transforms.iau2006XysData = new transforms.iau2006XysData.constructor()
}
