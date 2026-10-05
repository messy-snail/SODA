import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from './en'
import ko from './ko'

// Vite refuses to import a file outside its root, so the backend registry is read from
// disk. Vitest runs with the frontend directory as its working directory.
const ERRORS_PY = resolve(process.cwd(), '../src/soda/errors.py')

const HANGUL = /[ㄱ-ㆎ가-힣]/

function flatten(messages: object, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, value)
    else if (value && typeof value === 'object') {
      for (const [inner, text] of flatten(value, path)) out.set(inner, text)
    }
  }
  return out
}

const koFlat = flatten(ko)
const enFlat = flatten(en)

/** `{name}` placeholders a message expects its caller to fill. */
function params(text: string): Set<string> {
  return new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!))
}

/** Codes declared in src/soda/errors.py, which is the single source for both sides. */
function backendCodes(name: string): string[] {
  const source = readFileSync(ERRORS_PY, 'utf8')
  const block = source.split(`${name} = frozenset(`)[1]?.split(')')[0]
  if (!block) throw new Error(`src/soda/errors.py no longer declares ${name}`)
  return [...block.matchAll(/"([a-zA-Z]+)"/g)].map((match) => match[1]!)
}

describe('message catalogues', () => {
  it('translates every key, with no key left over', () => {
    expect([...enFlat.keys()].sort()).toEqual([...koFlat.keys()].sort())
  })

  it('leaves no Korean in the English catalogue', () => {
    const leaked = [...enFlat].filter(([, text]) => HANGUL.test(text))
    expect(leaked).toEqual([])
  })

  it('keeps the same interpolation parameters in both languages', () => {
    for (const [key, korean] of koFlat) {
      expect([...params(korean)].sort(), key).toEqual([...params(enFlat.get(key)!)].sort())
    }
  })

  it('has no empty message', () => {
    for (const [key, text] of [...koFlat, ...enFlat]) expect(text.trim(), key).not.toBe('')
  })
})

describe('backend message codes', () => {
  it('translates every error code the API can return', () => {
    const missing = backendCodes('ERROR_CODES').filter((code) => !koFlat.has(`errors.${code}`))
    expect(missing).toEqual([])
  })

  it('translates every warning code the API can attach', () => {
    const missing = backendCodes('WARNING_CODES').filter((code) => !koFlat.has(`warnings.${code}`))
    expect(missing).toEqual([])
  })

  it('declares no error key the backend never sends', () => {
    // The two the frontend raises itself are the only allowed extras.
    const ours = new Set([...backendCodes('ERROR_CODES'), 'requestFailed', 'networkUnreachable'])
    const extra = [...koFlat.keys()]
      .filter((key) => key.startsWith('errors.'))
      .map((key) => key.slice('errors.'.length))
      .filter((code) => !ours.has(code))
    expect(extra).toEqual([])
  })
})
