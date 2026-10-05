import { describe, expect, it } from 'vitest'
import { type NamedFile, resolveNamed, sortNamed } from './namedFiles'

function file(name: string): NamedFile {
  const norad_id = /^\d+$/.test(name) ? Number(name) : null
  const operator = name === 'default' || norad_id !== null ? null : name
  return { name, norad_id, operator }
}

describe('resolveNamed', () => {
  const items = [file('default'), file('starlink'), file('44713')]

  it('prefers the satellite, then its operator, then the default', () => {
    expect(resolveNamed(items, 44713, 'starlink')?.name).toBe('44713')
    expect(resolveNamed(items, 99999, 'starlink')?.name).toBe('starlink')
    expect(resolveNamed(items, 99999, 'oneweb')?.name).toBe('default')
    expect(resolveNamed(items, 99999, null)?.name).toBe('default')
  })

  it('ignores operator files when the caller has no operator', () => {
    // 3D models never pass one, so they must behave exactly as before.
    expect(resolveNamed(items, 99999)?.name).toBe('default')
    expect(resolveNamed([file('starlink')], 99999)).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(resolveNamed([file('44713')], 99999, 'oneweb')).toBeNull()
    expect(resolveNamed([], 44713, 'starlink')).toBeNull()
  })
})

describe('sortNamed', () => {
  it('orders default, then operators by name, then NORAD numbers', () => {
    const items = [file('44713'), file('starlink'), file('25544'), file('kari'), file('default')]
    expect(sortNamed(items).map((item) => item.name)).toEqual([
      'default',
      'kari',
      'starlink',
      '25544',
      '44713',
    ])
  })

  it('still sorts model lists that carry no operator field', () => {
    const models = [
      { name: '44713', norad_id: 44713 },
      { name: 'default', norad_id: null },
    ]
    expect(sortNamed(models).map((model) => model.name)).toEqual(['default', '44713'])
  })
})
