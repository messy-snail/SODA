import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'
import { LOCALE_STORAGE_KEY, SUPPORTED_LOCALES } from './locale'

/** Quoted strings assigned to ``const <name>`` in the inline boot script of index.html. */
function literals(name: string): string[] {
  const match = html.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]|'[^']*')`))
  if (!match) throw new Error(`index.html no longer declares ${name}`)
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((entry) => entry[1]!)
}

describe('index.html boot script', () => {
  it('knows the same languages the app does', () => {
    expect(literals('LOCALES').sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })

  it('reads the key the locale store writes', () => {
    expect(html).toContain(`localStorage.getItem('${LOCALE_STORAGE_KEY}')`)
  })

  it('tags the document before the first paint', () => {
    expect(html).toContain('document.documentElement.lang')
  })
})
