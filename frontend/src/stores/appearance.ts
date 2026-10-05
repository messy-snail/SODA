import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

/**
 * How see-through the panels are. `styles.css` owns the actual opacities: each theme has a
 * most and least opaque tint, and `intensity` only slides between the two, so no setting
 * can leave text sitting on bare stars.
 */
export interface Appearance {
  /** Liquid glass on: translucent, blurred panels. Off: near-opaque flat panels. */
  glass: boolean
  /** 0 = the theme's most opaque glass, 1 = its clearest. */
  intensity: number
  /** Bend the backdrop at pane rims (Chromium only; elsewhere this does nothing). */
  refraction: boolean
}

export const APPEARANCE_STORAGE_KEY = 'soda.appearance'
const DEFAULT_APPEARANCE: Appearance = { glass: true, intensity: 0.5, refraction: true }

/** Reads stored appearance, falling back field by field rather than failing the app. */
export function parseAppearance(raw: string | null): Appearance {
  try {
    const value = JSON.parse(raw ?? '{}') as Record<string, unknown>
    const intensity =
      typeof value.intensity === 'number' && Number.isFinite(value.intensity)
        ? Math.min(1, Math.max(0, value.intensity))
        : DEFAULT_APPEARANCE.intensity
    return { glass: value.glass !== false, intensity, refraction: value.refraction !== false }
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

function storage(): Storage | null {
  try {
    return new URLSearchParams(location.search).has('e2e') ? null : localStorage
  } catch {
    return null
  }
}

export const useAppearanceStore = defineStore('appearance', () => {
  const store = storage()
  let raw: string | null = null
  try {
    raw = store?.getItem(APPEARANCE_STORAGE_KEY) ?? null
  } catch {
    raw = null
  }
  const initial = parseAppearance(raw)
  const glass = ref(initial.glass)
  const intensity = ref(initial.intensity)
  const refraction = ref(initial.refraction)
  /** Set by the globe once it knows whether this browser can bend the backdrop. */
  const refractionSupported = ref(false)

  watch(
    [glass, intensity, refraction],
    () => {
      const root = document.documentElement
      root.dataset.glass = glass.value ? 'on' : 'off'
      try {
        const value: Appearance = {
          glass: glass.value,
          intensity: intensity.value,
          refraction: refraction.value,
        }
        store?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(value))
      } catch {
        // Storage full or blocked: the choice just does not survive a reload.
      }
    },
    { immediate: true },
  )

  function reset() {
    glass.value = DEFAULT_APPEARANCE.glass
    intensity.value = DEFAULT_APPEARANCE.intensity
    refraction.value = DEFAULT_APPEARANCE.refraction
  }

  return { glass, intensity, refraction, refractionSupported, reset }
})
