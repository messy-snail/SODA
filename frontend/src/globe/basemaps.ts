import {
  buildModuleUrl,
  Credit,
  CreditDisplay,
  ImageryLayer,
  IonImageryProvider,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  type ImageryProvider,
  type Viewer,
} from 'cesium'
import type { Label } from '../i18n/label'
import type { BasemapId } from '../theme/presets'

export interface BasemapOption {
  id: BasemapId
  /** Lives with the table rather than in the message catalogue; see i18n/label.ts. */
  label: Label
  /** Served through Cesium ion, whose terms require the ion logo on screen. */
  ion?: boolean
  create: () => ImageryProvider | Promise<ImageryProvider>
}

const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services'
const hasIonToken = Boolean(import.meta.env.VITE_CESIUM_ION_TOKEN)

function esri(service: string, credit: string, maximumLevel: number) {
  return () =>
    new UrlTemplateImageryProvider({
      url: `${ESRI}/${service}/MapServer/tile/{z}/{y}/{x}`,
      maximumLevel,
      // On screen, not only in the "Data attribution" popover.
      credit: new Credit(credit, true),
    })
}

export const basemaps: BasemapOption[] = [
  {
    id: 'esri-imagery',
    label: { ko: '위성영상 (Esri World Imagery)', en: 'Imagery (Esri World Imagery)' },
    create: esri(
      'World_Imagery',
      'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      19,
    ),
  },
  {
    id: 'esri-street',
    label: { ko: '지도 (Esri World Street Map)', en: 'Street map (Esri World Street Map)' },
    create: esri(
      'World_Street_Map',
      'Esri, HERE, Garmin, USGS, NGA, and the GIS User Community',
      19,
    ),
  },
  {
    id: 'esri-light',
    label: { ko: '라이트 캔버스 (Esri Light Gray)', en: 'Light canvas (Esri Light Gray)' },
    create: esri(
      'Canvas/World_Light_Gray_Base',
      'Esri, HERE, Garmin, and the GIS User Community',
      16,
    ),
  },
  {
    id: 'esri-dark',
    label: { ko: '다크 캔버스 (Esri Dark Gray)', en: 'Dark canvas (Esri Dark Gray)' },
    create: esri(
      'Canvas/World_Dark_Gray_Base',
      'Esri, HERE, Garmin, and the GIS User Community',
      16,
    ),
  },
  {
    id: 'natural-earth',
    label: { ko: '오프라인 (Natural Earth II)', en: 'Offline (Natural Earth II)' },
    create: () =>
      TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII')),
  },
  ...(hasIonToken
    ? [
        {
          id: 'bing-aerial' as const,
          label: { ko: 'Bing Aerial (Cesium ion)', en: 'Bing Aerial (Cesium ion)' },
          ion: true,
          create: () => IonImageryProvider.fromAssetId(2),
        },
      ]
    : []),
]

let ionLogo: Credit | undefined
let sodaLogo: Credit | undefined

const creditMark = (tone: 'light' | 'dark') =>
  `<img class="on-${tone}" src="${import.meta.env.BASE_URL}brand/favicon-${tone}.svg" alt="">`

/** Show the Cesium ion logo only while ion content is in use, and the SODA mark otherwise. */
function setLogoCredit(ion: boolean) {
  ionLogo ??= CreditDisplay.cesiumCredit
  // The credit HTML stays static; ``html[data-theme]`` CSS picks the mark that fits the theme.
  sodaLogo ??= new Credit(
    `<span class="soda-credit">${creditMark('light')}${creditMark('dark')}SODA</span>`,
    true,
  )
  CreditDisplay.cesiumCredit = ion ? ionLogo : sodaLogo
}

/** The base layer each viewer shows, so a swap leaves overlays such as the country tint. */
const baseLayers = new WeakMap<Viewer, ImageryLayer>()

/** Replace the base imagery layer, falling back to the offline texture on failure. */
export function applyBasemap(viewer: Viewer, id: BasemapOption['id']) {
  const option = basemaps.find((item) => item.id === id) ?? basemaps[0]!
  setLogoCredit(Boolean(option.ion))
  const layers = viewer.imageryLayers
  const layer = ImageryLayer.fromProviderAsync(Promise.resolve(option.create()), {})
  layer.errorEvent.addEventListener(() => {
    if (option.id === 'natural-earth' || viewer.isDestroyed()) return
    applyBasemap(viewer, 'natural-earth')
  })
  layers.add(layer, 0)
  const previous = baseLayers.get(viewer)
  if (previous && layers.contains(previous)) layers.remove(previous)
  baseLayers.set(viewer, layer)
}
