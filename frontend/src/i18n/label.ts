import type { Label } from '../stations/types'
import type { Locale } from './locale'

export type { Label }

/**
 * Read a two-language name that lives with its data.
 *
 * Names attached to a data table - operators, basemaps, sensor presets, ground stations -
 * stay next to the table so a new row is one edit, and so modules the tests import without
 * Vue never have to reach for the message catalogue.
 */
export function pick(label: Label, locale: Locale): string {
  return label[locale]
}
