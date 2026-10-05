import { describe, expect, it } from 'vitest'
import {
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  isLocale,
  isLocalePreference,
  resolveLocale,
} from './locale'

describe('locale guards', () => {
  it('accepts only the languages that exist', () => {
    expect(SUPPORTED_LOCALES).toEqual(['ko', 'en'])
    expect(isLocale('ko')).toBe(true)
    expect(isLocale('en')).toBe(true)
    expect(isLocale('system')).toBe(false)
    expect(isLocale('ja')).toBe(false)
    expect(isLocale(null)).toBe(false)
  })

  it('accepts system as a preference but not as a language', () => {
    expect(isLocalePreference('system')).toBe(true)
    expect(isLocalePreference('ko')).toBe(true)
    expect(isLocalePreference('jp')).toBe(false)
    expect(isLocalePreference(undefined)).toBe(false)
  })

  it('names the storage key the boot script also reads', () => {
    expect(LOCALE_STORAGE_KEY).toBe('soda.locale')
  })
})

describe('resolveLocale', () => {
  it('returns an explicit choice untouched', () => {
    expect(resolveLocale('ko', ['en-US'])).toBe('ko')
    expect(resolveLocale('en', ['ko-KR'])).toBe('en')
  })

  it('follows the browser when the preference is system', () => {
    expect(resolveLocale('system', ['ko-KR', 'en-US'])).toBe('ko')
    expect(resolveLocale('system', ['en-GB', 'ko'])).toBe('ko')
    expect(resolveLocale('system', ['en-US'])).toBe('en')
  })

  it('sends a reader of a third language to English, not Korean', () => {
    expect(resolveLocale('system', ['ja-JP', 'fr-FR'])).toBe('en')
    expect(resolveLocale('system', [])).toBe('en')
    expect(resolveLocale('system')).toBe('en')
  })

  it('does not mistake a language that merely starts with ko', () => {
    expect(resolveLocale('system', ['kok-IN'])).toBe('en')
  })
})
