import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { setLocale } from './index'
import {
  LOCALE_STORAGE_KEY,
  isLocale,
  isLocalePreference,
  resolveLocale,
  type LocalePreference,
} from './locale'

/**
 * A `?lang=` in the URL wins over the stored choice but is never written back: the smoke
 * test pins the language without disturbing what the reader picked.
 */
function queryLocale(): LocalePreference | null {
  try {
    const value = new URLSearchParams(location.search).get('lang')
    return isLocale(value) ? value : null
  } catch {
    return null
  }
}

function readPreference(): LocalePreference {
  const pinned = queryLocale()
  if (pinned) return pinned
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isLocalePreference(saved)) return saved
  } catch {
    /* Follow the browser when storage is unavailable. */
  }
  return 'system'
}

export const useLocaleStore = defineStore('locale', () => {
  const pinned = queryLocale()
  const preference = ref<LocalePreference>(readPreference())
  const locale = computed(() => resolveLocale(preference.value, navigator.languages ?? []))

  watch(
    [preference, locale],
    () => {
      if (!pinned) {
        try {
          localStorage.setItem(LOCALE_STORAGE_KEY, preference.value)
        } catch {
          /* Session only. */
        }
      }
      setLocale(locale.value)
      document.documentElement.lang = locale.value
    },
    { immediate: true },
  )

  return { preference, locale }
})
