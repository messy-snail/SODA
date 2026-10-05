import { createI18n } from 'vue-i18n'
import { en as vuetifyEn, ko as vuetifyKo } from 'vuetify/locale'
import en from './en'
import ko from './ko'
import { SUPPORTED_LOCALES, type Locale } from './locale'

/** Shape every language has to fill. `en/index.ts` declares itself as this type, so a
 *  missing or misspelled key fails `vue-tsc` rather than showing up as a raw key on screen. */
export type MessageSchema = typeof ko

export { SUPPORTED_LOCALES }
export type { Locale }

// Vuetify's own strings ride along under $vuetify through the locale adapter.
const koMessages = { ...ko, $vuetify: vuetifyKo }
const enMessages = { ...en, $vuetify: vuetifyEn }

/**
 * Korean is the fallback rather than English: it is the language every message is written
 * in first, so a key not yet translated still renders real text.
 */
export const i18n = createI18n<[typeof koMessages], Locale>({
  legacy: false,
  locale: 'ko',
  fallbackLocale: 'ko',
  messages: { ko: koMessages, en: enMessages },
})

/**
 * Switch languages.
 *
 * `i18n.global` is typed as the union of the legacy and composition APIs, so the writable
 * ref behind `locale` needs one cast rather than a check at every call site.
 */
export function setLocale(locale: Locale): void {
  ;(i18n.global.locale as unknown as { value: Locale }).value = locale
}

/** `t` with vue-i18n's overloads collapsed, for pure helpers that only need a lookup. */
export function translate(key: string, params: Record<string, unknown> = {}): string {
  return (i18n.global.t as (key: string, params: Record<string, unknown>) => string)(key, params)
}
