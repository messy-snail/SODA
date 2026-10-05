import type { Category } from '../api/types'

export const BASEMAP_IDS = [
  'esri-imagery',
  'esri-street',
  'esri-light',
  'esri-dark',
  'natural-earth',
  'bing-aerial',
] as const
export type BasemapId = (typeof BASEMAP_IDS)[number]
/** SODA ships a single theme; the app has no theme switch. */
export type PresetId = 'sodaDark'

/** Colors and defaults the Cesium layers read from the active preset. */
export interface GlobeStyle {
  basemap: BasemapId
  orbitPalette: string[]
  inertialReference: string
  nadir: string
  fieldOfRegard: string
  night: string
  cone: string
  /** Ground station colours, handed out in order so several stations stay apart. */
  stationPalette: string[]
  /** Country outlines drawn over the basemap. */
  border: string
  /** Country fills by Natural Earth MAPCOLOR7, so neighbours always differ. */
  countryTintPalette: string[]
  countryTintOpacity: number
  /** Country name fill and the halo that keeps it legible on any basemap. */
  countryLabel: string
  countryLabelOutline: string
  /** Place pin colours, handed out in order like the station palette. */
  pinPalette: string[]
  /** Pin name tags: a surface-coloured chip, so the name reads on any basemap. */
  chipBackground: string
  chipText: string
  /** Opaque backdrop behind logos painted on satellite shapes. */
  logoBackground: string
  /** Imaging targets (points and areas) of the mission tool. */
  aoi: string
  /** Packet dots on the simulated TC/TM link, matching the packet log's arrows. */
  link: { up: string; down: string }
  /** Element-age grades (`orbit/epochTrust.ts`): globe tint, badge and faded orbit stretches. */
  trust: { caution: string; low: string; poor: string }
  /** Eclipse display (`orbit/eclipse.ts`, `globe/eclipseLayer.ts`). */
  eclipse: {
    /** Eclipsed stretches of an orbit line keep the run colour at this brightness and alpha. */
    lineBrightness: number
    lineAlpha: number
    /** The Earth's shadow at the followed satellite's height, on the 2D map. */
    shadow: string
    shadowOpacity: number
    shadowEdge: string
    /** The night side on the 2D map; each twilight step adds one more layer of this opacity. */
    terminator: string
    terminatorOpacity: number
    /** Eclipsed stretches of the clock slider. */
    band: string
  }
  /**
   * Coverage map of the imaging tool (`globe/coverageLayer.ts`): a ramp from low to high,
   * the colour of cells with no value, and the opacity of the whole overlay.
   */
  coverage: { ramp: string[]; empty: string; opacity: number }
  categories: Record<Category, string>
}

export interface ThemePreset {
  id: PresetId
  label: string
  dark: boolean
  colors: Record<string, string>
  globe: GlobeStyle
}

const darkCategories: Record<Category, string> = {
  LEO: '#64b5f6',
  MEO: '#81c784',
  GEO: '#ffc247',
  HEO: '#ce93d8',
  DEBRIS: '#8a96a3',
}

export const presets: ThemePreset[] = [
  {
    id: 'sodaDark',
    label: 'SODA Dark',
    dark: true,
    colors: {
      background: '#101820',
      surface: '#1c2633',
      'surface-variant': '#263548',
      primary: '#64b5f6',
      'frame-fixed': '#64b5f6',
      'frame-inertial': '#ffad42',
      /* Imagery sensor chips: a camera's picture and a radar's are told apart at a glance. */
      'sensor-optical': '#4dd0e1',
      'sensor-sar': '#ce93d8',
      secondary: '#90a4ae',
      success: '#66bb6a',
      warning: '#ffb74d',
      error: '#ef9a9a',
      info: '#4fc3f7',
      'on-background': '#e5edf6',
      'on-surface': '#f4f7fb',
      /* Tooltips draw on surface-variant; Vuetify's inherited default fails contrast. */
      'on-surface-variant': '#f4f7fb',
      /* Liquid-glass rim light and drop shadow (styles.css `.glass`). */
      'glass-edge': '#b8c9dd',
      'glass-shadow': '#000000',
    },
    globe: {
      basemap: 'esri-imagery',
      inertialReference: '#ffad42',
      orbitPalette: ['#64b5f6', '#f48fb1', '#81c784', '#ffb74d', '#ce93d8', '#4dd0e1'],
      nadir: '#64b5f6',
      fieldOfRegard: '#b3e5fc',
      night: '#90a4ae',
      cone: '#64b5f6',
      stationPalette: ['#ff8a80', '#4dd0e1', '#ce93d8', '#ffb74d', '#81c784', '#64b5f6'],
      border: '#c3cfdc',
      countryTintPalette: [
        '#ef9a9a',
        '#90caf9',
        '#a5d6a7',
        '#ffcc80',
        '#ce93d8',
        '#80cbc4',
        '#f48fb1',
      ],
      countryTintOpacity: 0.28,
      countryLabel: '#f1f5f9',
      countryLabelOutline: '#0b1a2e',
      pinPalette: ['#e53935', '#8e24aa', '#00897b', '#ef6c00', '#3949ab', '#2e7d32'],
      chipBackground: '#1c2633',
      chipText: '#f4f7fb',
      logoBackground: '#ffffff',
      aoi: '#ffd54f',
      link: { up: '#ffb74d', down: '#64b5f6' },
      trust: { caution: '#ffd54f', low: '#ffa726', poor: '#ef5350' },
      eclipse: {
        lineBrightness: 0.45,
        lineAlpha: 0.9,
        shadow: '#05080f',
        shadowOpacity: 0.4,
        shadowEdge: '#b8c9dd',
        terminator: '#05080f',
        terminatorOpacity: 0.12,
        band: '#7986cb',
      },
      coverage: {
        ramp: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
        empty: '#5c6773',
        opacity: 0.78,
      },
      categories: darkCategories,
    },
  },
]

/** The one theme the app uses. */
export const activePreset: ThemePreset = presets[0]!

export const vuetifyThemes = Object.fromEntries(
  presets.map((preset) => [preset.id, { dark: preset.dark, colors: preset.colors }]),
)
