import type { ApiWarning } from './types'
import { ApiError } from './client'

/** Signature of vue-i18n's `t`, kept structural so pure helpers stay testable. */
export type Translate = (key: string, params?: Record<string, unknown>) => string

function render(
  namespace: 'errors' | 'warnings',
  code: string,
  fallback: string,
  params: Record<string, unknown>,
  translate?: Translate,
): string {
  if (!translate) return fallback
  const key = `${namespace}.${code}`
  const text = translate(key, params)
  // vue-i18n echoes the key back when it has no entry; the server text beats a raw key.
  return text === key ? fallback : text
}

export function warningText(warning: ApiWarning, translate?: Translate): string {
  if (typeof warning === 'string') return warning
  return render('warnings', warning.code, warning.message, warning.params ?? {}, translate)
}

/** Deduplicated warning lines, so the same stale-elements note is not shown twice. */
export function warningTexts(warnings: ApiWarning[], translate?: Translate): string[] {
  return [...new Set(warnings.map((warning) => warningText(warning, translate)))]
}

export function apiErrorText(error: unknown, translate?: Translate): string {
  if (error instanceof ApiError) {
    if (!error.code) return error.message
    return render('errors', error.code, error.message, error.params, translate)
  }
  if (error instanceof Error) return error.message
  return String(error)
}
