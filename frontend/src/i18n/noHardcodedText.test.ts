import { describe, expect, it } from 'vitest'

const HANGUL = /[ㄱ-ㆎ가-힣]/

/** Every source file under src/, as text. */
const sources = import.meta.glob('../**/*.{ts,vue}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Files allowed to hold Korean.
 *
 * Two kinds: the Korean catalogue itself, and data tables whose names live with their rows
 * as `{ ko, en }` records - see i18n/label.ts for why. Everything else goes through `t()`,
 * which is what keeps the English UI free of Korean.
 */
const ALLOWED = [
  /^src\/i18n\/ko\//,
  /^src\/stations\//,
  /^src\/utils\/operators\.ts$/,
  /^src\/sensors\/presets\.ts$/,
  /^src\/globe\/basemaps\.ts$/,
  /^src\/catalog\/groups\.ts$/,
  /^src\/imagery\/samples\.ts$/,
  /^src\/theme\/presets\.ts$/,
  // Each language names itself in the switcher, so a reader can find their own.
  /^src\/components\/LocaleMenu\.vue$/,
  /\.test\.ts$/,
]

/** Glob keys are relative to this directory; turn them back into repo paths. */
function repoPath(key: string): string {
  return key.startsWith('./') ? `src/i18n/${key.slice(2)}` : `src/${key.slice(3)}`
}

describe('no hard-coded Korean outside the catalogue', () => {
  it('scans a realistic number of files', () => {
    // Guards against the glob silently matching nothing and the test passing for free.
    expect(Object.keys(sources).length).toBeGreaterThan(50)
  })

  it('routes every other user-facing string through t()', () => {
    const offenders: string[] = []
    for (const [key, text] of Object.entries(sources)) {
      const file = repoPath(key)
      if (ALLOWED.some((pattern) => pattern.test(file))) continue
      const line = text.split('\n').findIndex((entry) => HANGUL.test(entry))
      if (line >= 0) offenders.push(`${file}:${line + 1}`)
    }
    expect(offenders).toEqual([])
  })
})
