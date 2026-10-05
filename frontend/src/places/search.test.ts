import { describe, expect, it } from 'vitest'
import type { City, Country } from './geoData'
import { formatLatLon, parseLatLon, searchPlaces } from './search'

describe('parseLatLon', () => {
  it('reads plain pairs as latitude then longitude', () => {
    expect(parseLatLon('37.5, 127')).toEqual({ lat_deg: 37.5, lon_deg: 127 })
    expect(parseLatLon('37.5 127')).toEqual({ lat_deg: 37.5, lon_deg: 127 })
    expect(parseLatLon(' -33.9 , 18.4 ')).toEqual({ lat_deg: -33.9, lon_deg: 18.4 })
    expect(parseLatLon('-33.9 -70.6')).toEqual({ lat_deg: -33.9, lon_deg: -70.6 })
  })

  it('follows hemisphere letters in either order', () => {
    expect(parseLatLon('37.5N 127E')).toEqual({ lat_deg: 37.5, lon_deg: 127 })
    expect(parseLatLon('127E 37.5N')).toEqual({ lat_deg: 37.5, lon_deg: 127 })
    expect(parseLatLon('33.9S, 18.4W')).toEqual({ lat_deg: -33.9, lon_deg: -18.4 })
    expect(parseLatLon('37.5°n 127°e')).toEqual({ lat_deg: 37.5, lon_deg: 127 })
  })

  it('reads back what formatLatLon writes', () => {
    expect(parseLatLon(formatLatLon(-12.3456, -45.6789))).toEqual({
      lat_deg: -12.3456,
      lon_deg: -45.6789,
    })
  })

  it('rejects out-of-range and ambiguous input', () => {
    expect(parseLatLon('91, 0')).toBeNull()
    expect(parseLatLon('0, 181')).toBeNull()
    expect(parseLatLon('37N 38N')).toBeNull()
    expect(parseLatLon('-37S 127E')).toBeNull()
    expect(parseLatLon('37.5')).toBeNull()
    expect(parseLatLon('1, 2, 3')).toBeNull()
    expect(parseLatLon('Seoul')).toBeNull()
    expect(parseLatLon('')).toBeNull()
  })
})

const country = (iso2: string, ko: string, en: string): Country => ({
  a3: iso2,
  iso2,
  name: { ko, en },
  label: [0, 0],
  bbox: [0, 0, 1, 1],
  rank: 2,
})
const city = (ko: string, en: string, pop: number): City => ({
  name: { ko, en },
  iso2: 'XX',
  lon: 0,
  lat: 0,
  pop,
  capital: false,
})

describe('searchPlaces', () => {
  const countries = [
    country('KR', '대한민국', 'South Korea'),
    country('KP', '조선민주주의인민공화국', 'North Korea'),
    country('JP', '일본', 'Japan'),
  ]
  const cities = [
    city('서울특별시', 'Seoul', 9_796_000),
    city('대전광역시', 'Daejeon', 1_468_000),
    city('대구광역시', 'Daegu', 2_460_000),
    city('코리아타운', 'Koreatown', 10),
  ]
  const names = (query: string, locale: 'ko' | 'en' = 'ko') =>
    searchPlaces(query, countries, cities, locale).map((hit) =>
      hit.kind === 'country' ? hit.country.name.en : hit.city.name.en,
    )

  it('matches either language, ignoring case and spaces', () => {
    expect(names('서울')).toEqual(['Seoul'])
    expect(names('seoul')).toEqual(['Seoul'])
    expect(names('south korea', 'en')).toEqual(['South Korea'])
    expect(names('kr')).toContain('South Korea')
  })

  it('ranks exact over prefix over substring, countries before cities', () => {
    expect(names('japan')).toEqual(['Japan'])
    expect(names('대')).toEqual(['South Korea', 'Daegu', 'Daejeon'])
    expect(names('korea', 'en')).toEqual(['Koreatown', 'South Korea', 'North Korea'])
  })

  it('returns nothing for an empty query', () => {
    expect(names('   ')).toEqual([])
  })
})
