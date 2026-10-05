import { describe, expect, it } from 'vitest'
import { parseOrbitFilter } from './orbitFilter'

describe('parseOrbitFilter', () => {
  it('defaults to LEO when nothing usable is stored', () => {
    expect(parseOrbitFilter(null)).toEqual(['LEO'])
    expect(parseOrbitFilter('{')).toEqual(['LEO'])
    expect(parseOrbitFilter('"GEO"')).toEqual(['LEO'])
  })

  it('keeps known classes in display order and an empty list as "all"', () => {
    expect(parseOrbitFilter('["GEO","LEO","DEBRIS","x"]')).toEqual(['LEO', 'GEO'])
    expect(parseOrbitFilter('[]')).toEqual([])
  })
})
