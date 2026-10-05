import { defineStore } from 'pinia'
import { activePreset } from './presets'

/** The active theme. SODA Dark is the only one; the store keeps callers independent of that. */
export const useThemePreset = defineStore('theme', () => {
  const preset = activePreset
  document.documentElement.dataset.theme = 'dark'
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', preset.colors.background ?? '#101820')
  return { preset }
})
