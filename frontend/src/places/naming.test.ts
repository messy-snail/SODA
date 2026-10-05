import { describe, expect, it } from 'vitest'
import type { City, Country } from './geoData'
import { defaultPinName, distanceKm, uniqueName, type NamingData } from './naming'
import { indexShapes } from './tint'

const city = (en: string, ko: string, lon: number, lat: number): City => ({
  name: { ko, en },
  iso2: 'KR',
  lon,
  lat,
  pop: 1,
  capital: false,
})

const data: NamingData = {
  cities: [city('Daejeon', '대전광역시', 127.42, 36.34), city('Seoul', '서울특별시', 127, 37.57)],
  countries: [
    {
      a3: 'KOR',
      iso2: 'KR',
      name: { ko: '대한민국', en: 'South Korea' },
      label: [128, 36],
      bbox: [126, 34, 130, 39],
      rank: 2,
    } as Country,
  ],
  shapes: indexShapes([
    { a3: 'KOR', iso2: 'KR', color: 1, rings: [[126, 34, 130, 34, 130, 39, 126, 39, 126, 34]] },
  ]),
}

describe('distanceKm', () => {
  it('is about 111 km per degree of latitude', () => {
    expect(distanceKm(0, 0, 0, 1)).toBeCloseTo(111.2, 0)
  })
})

describe('defaultPinName', () => {
  it('names a point after a city within 30 km', () => {
    expect(defaultPinName(127.4, 36.3, data, 'ko', [], 'Pin 1')).toBe('대전광역시')
    expect(defaultPinName(127.4, 36.3, data, 'en', [], 'Pin 1')).toBe('Daejeon')
  })

  it('falls back to the country, then to the numbered name', () => {
    expect(defaultPinName(128.5, 35, data, 'ko', [], '핀 1')).toBe('대한민국')
    expect(defaultPinName(-150, 0, data, 'ko', [], '핀 1')).toBe('핀 1')
    expect(defaultPinName(127.4, 36.3, null, 'ko', [], '핀 1')).toBe('핀 1')
  })

  it('never repeats a name already taken', () => {
    expect(defaultPinName(127.4, 36.3, data, 'en', ['Daejeon'], 'Pin 2')).toBe('Daejeon (2)')
  })
})

describe('uniqueName', () => {
  it('counts up past every taken suffix', () => {
    expect(uniqueName('A', ['A', 'A (2)'])).toBe('A (3)')
    expect(uniqueName('B', ['A'])).toBe('B')
  })
})
