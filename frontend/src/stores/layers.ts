import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import type { Category } from '../api/types'
import {
  defaultCloudStyle,
  normalizeHex,
  resolveCategoryColors,
  sanitizeCloudStyle,
  type CloudStyle,
} from '../theme/categoryColors'
import { BASEMAP_IDS, type BasemapId } from '../theme/presets'
import { useThemePreset } from '../theme/useThemePreset'
import {
  DEFAULT_IMAGERY_PREF,
  sanitizeImageryPrefs,
  type ImageryPref,
  type ImageryPrefs,
} from '../utils/imagery'
import { defaultMarkerStyle, sanitizeMarkerStyle, type MarkerStyle } from '../utils/markerStyle'
import { useUiStore } from './ui'

export type OrbitFrame = 'fixed' | 'inertial'

interface LayerPreferences {
  /** Bumped when a new default should replace what older browsers stored; see readPreferences. */
  version: number
  basemapOverride: BasemapId | null
  showSatellites: boolean
  showStations: boolean
  showModels: boolean
  showCountryTint: boolean
  /** Country outlines, drawn into the same overlay as the tint. */
  showBorders: boolean
  showCountryLabels: boolean
  lighting: boolean
  /** Dimmed eclipse stretches of orbit lines, the clock band and the 2D shadow area. */
  showEclipse: boolean
  frame: OrbitFrame
  cloudStyle: CloudStyle
  markerStyle: MarkerStyle
  showScaleBar: boolean
  /** Draw user imagery when the camera zooms in on it. */
  showUserImagery: boolean
  /** How opaque each user imagery set is drawn; a set without an entry is opaque. */
  imagery: ImageryPrefs
}

const STORAGE_KEY = 'soda.layers'
/** 1: the marker shape default became a cube. */
const PREFS_VERSION = 1

function defaults(): LayerPreferences {
  return {
    version: PREFS_VERSION,
    basemapOverride: null,
    showSatellites: true,
    showStations: true,
    showModels: true,
    showCountryTint: false,
    showBorders: false,
    showCountryLabels: false,
    lighting: true,
    showEclipse: true,
    frame: 'fixed',
    cloudStyle: defaultCloudStyle(),
    markerStyle: defaultMarkerStyle(),
    showScaleBar: true,
    showUserImagery: true,
    imagery: {},
  }
}

/** Load stored preferences, repairing malformed values and migrating outdated defaults. */
export function readPreferences(): LayerPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const saved = { ...defaults(), ...stored }
    if (!(BASEMAP_IDS as readonly unknown[]).includes(saved.basemapOverride)) {
      saved.basemapOverride = null
    }
    saved.frame = 'fixed'
    saved.cloudStyle = sanitizeCloudStyle(saved.cloudStyle)
    saved.markerStyle = sanitizeMarkerStyle(saved.markerStyle)
    saved.imagery = sanitizeImageryPrefs(saved.imagery)
    // Read the version off `stored`, not `saved`: the merge above would have supplied the
    // current one and the migration would never run. Size and pixel floor stay as chosen.
    if (stored.version !== PREFS_VERSION) {
      saved.markerStyle.shape = defaultMarkerStyle().shape
      saved.version = PREFS_VERSION
    }
    return saved
  } catch {
    return defaults()
  }
}

export const useLayersStore = defineStore('layers', () => {
  const theme = useThemePreset()
  const ui = useUiStore()
  const prefs = reactive(readPreferences())
  /** Inertial transform readiness, written by the reference-frame layer. */
  const frameState = reactive({ loading: false, ready: false, failed: false })
  // The 2D map is Earth-fixed by nature; `prefs.frame` is kept so 3D restores the choice.
  const effectiveFrame = computed<OrbitFrame>(() =>
    prefs.frame === 'inertial' && frameState.ready && ui.sceneMode === '3d' ? 'inertial' : 'fixed',
  )
  const cloud = reactive({ loading: false, count: 0, error: '' })
  /** Open while the ECI warning waits for the user; the dialog lives in App.vue. */
  const confirmInertial = ref(false)

  /** Switch frames; the inertial view is confirmed first because it confuses at first. */
  function requestFrame(frame: OrbitFrame) {
    if (frame === 'inertial' && prefs.frame !== 'inertial') confirmInertial.value = true
    else if (frame === 'fixed') prefs.frame = 'fixed'
  }

  function acceptInertial() {
    confirmInertial.value = false
    prefs.frame = 'inertial'
  }

  /** Category colors after user overrides; the only source for satellite category colors. */
  const categoryColors = computed(() =>
    resolveCategoryColors(theme.preset.globe.categories, prefs.cloudStyle.colors),
  )

  function setCategoryColor(category: Category, value: string | null) {
    const hex = normalizeHex(value)
    if (hex) prefs.cloudStyle.colors[category] = hex
    else if (value === null) delete prefs.cloudStyle.colors[category]
  }

  function toggleCategory(category: Category) {
    const { hidden } = prefs.cloudStyle
    const index = hidden.indexOf(category)
    if (index >= 0) hidden.splice(index, 1)
    else hidden.push(category)
  }

  function resetCloudStyle() {
    prefs.cloudStyle = defaultCloudStyle()
  }

  function imageryPref(id: string): ImageryPref {
    return prefs.imagery[id] ?? DEFAULT_IMAGERY_PREF
  }

  function setImageryOpacity(id: string, opacity: number) {
    prefs.imagery[id] = { opacity: Math.min(1, Math.max(0, opacity)) }
  }

  /** Forget sets that no longer exist, so the stored choices do not grow without bound. */
  function pruneImagery(ids: readonly string[]) {
    for (const id of Object.keys(prefs.imagery)) {
      if (!ids.includes(id)) delete prefs.imagery[id]
    }
  }

  watch(
    prefs,
    () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
      } catch {
        /* Session only. */
      }
    },
    { deep: true },
  )

  return {
    prefs,
    frameState,
    effectiveFrame,
    confirmInertial,
    requestFrame,
    acceptInertial,
    cloud,
    categoryColors,
    setCategoryColor,
    toggleCategory,
    resetCloudStyle,
    imageryPref,
    setImageryOpacity,
    pruneImagery,
  }
})
