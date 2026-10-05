/** Locale preference handling, pure so it can be tested without Vue or vue-i18n. */

export const SUPPORTED_LOCALES = ['ko', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export type LocalePreference = 'system' | Locale

export const LOCALE_STORAGE_KEY = 'soda.locale'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'system' || isLocale(value)
}

/**
 * Resolve a preference against the browser's languages.
 *
 * Anything that is not Korean falls to English, which is the only other language the app
 * has; a reader of a third language is better served by English than by Korean.
 */
export function resolveLocale(
  preference: LocalePreference,
  languages: readonly string[] = [],
): Locale {
  if (preference !== 'system') return preference
  for (const tag of languages) {
    if (/^ko\b/i.test(tag)) return 'ko'
  }
  return 'en'
}
