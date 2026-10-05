import { describe, expect, it } from 'vitest'
import { OPERATOR_RULES, isDebrisName, operatorKey, operatorTitle } from './operators'

describe('operatorKey', () => {
  it('matches the large constellations by name prefix', () => {
    expect(operatorKey('STARLINK-1234', 44713)).toBe('starlink')
    expect(operatorKey('STARLINK-11425 [DTC]', 60000)).toBe('starlink')
    expect(operatorKey('ONEWEB-0425', 48000)).toBe('oneweb')
    expect(operatorKey('FLOCK 4BE-1', 47000)).toBe('planet')
    expect(operatorKey('LEMUR-2-VUKASIN', 46000)).toBe('spire')
  })

  it('separates names that share a prefix, in rule order', () => {
    // ISRO's GSAT-10 and Galileo's GSAT0101 both start with GSAT.
    expect(operatorKey('GSAT0101 (GALILEO-PFM)', 37846)).toBe('galileo')
    expect(operatorKey('GSAT-10', 38779)).toBe('isro')
    // GLONASS hides inside a COSMOS name.
    expect(operatorKey('COSMOS 2432 [GLONASS-M]', 32275)).toBe('glonass')
    expect(operatorKey('COSMOS 2385', 27470)).toBe('cosmos')
  })

  it('handles the O3b records CelesTrak spells with a zero', () => {
    expect(operatorKey('O3B FM10', 40079)).toBe('ses')
    expect(operatorKey('03B MPOWER F12', 61045)).toBe('ses')
  })

  it('recognizes Korean operators', () => {
    expect(operatorKey('BLUEBON', 62688)).toBe('telepix')
    expect(operatorKey('SPACEEYE-T1', 63229)).toBe('si')
    expect(operatorKey('ARIRANG-3 (KOMPSAT-3)', 38338)).toBe('kari')
    expect(operatorKey('GEO-KOMPSAT-2A', 43823)).toBe('kari')
    expect(operatorKey('CAS500-2', 69013)).toBe('kari')
    expect(operatorKey('KOREASAT 5A', 42984)).toBe('ktsat')
    expect(operatorKey('SNIPE 2', 56745)).toBe('kasi')
    expect(operatorKey('STSAT-3', 39422)).toBe('kasi')
    expect(operatorKey('NEXTSAT-1', 43811)).toBe('kaist')
    expect(operatorKey('SNUGLITE-III', 66661)).toBe('snu')
    expect(operatorKey('CONTECSAT-1', 59117)).toBe('contec')
  })

  it('pins satellites whose names are too common to match on', () => {
    expect(operatorKey('OBSERVER-1A', 58323)).toBe('naraspace')
    expect(operatorKey('MIMAN', 52900)).toBe('kairospace')
    expect(operatorKey('STEP CUBE LAB-II', 52897)).toBe('chosun')
    // Same names, different objects: the NORAD number is what decides.
    expect(operatorKey('OBSERVER-1A', 99999)).toBeNull()
    expect(operatorKey('MIMAN', 99999)).toBeNull()
  })

  it('keeps launch debris out of the operator logos', () => {
    expect(operatorKey('CAS500-2 RIDESHARE OBJECT K', 68989)).toBeNull()
    expect(operatorKey('CAS500-2 RIDESHARE OBJECT AF', 69009)).toBeNull()
    expect(operatorKey('STARLINK DEBRIS', 90001)).toBeNull()
    expect(operatorKey('IRIDIUM 33 DEB', 90002)).toBeNull()
  })

  it('credits the operator, not the manufacturer', () => {
    // Satrec Initiative built these, but Deimos Imaging, MBRSC, and NTU fly them.
    expect(operatorKey('DEIMOS-2', 40013)).toBeNull()
    expect(operatorKey('DUBAISAT-2', 39419)).toBeNull()
    expect(operatorKey('X-SAT', 37389)).toBeNull()
  })

  it('returns null for unnamed objects and unknown operators', () => {
    expect(operatorKey('2021-050D', 48900)).toBeNull()
    expect(operatorKey('', 1)).toBeNull()
  })
})

describe('OPERATOR_RULES', () => {
  it('uses slugs the backend accepts as file names', () => {
    for (const rule of OPERATOR_RULES) {
      expect(rule.slug).toMatch(/^[a-z][a-z0-9-]{1,31}$/)
      expect(rule.title).not.toBe('')
    }
  })

  it('has no duplicate slugs', () => {
    const slugs = OPERATOR_RULES.map((rule) => rule.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('gives every rule something to match on', () => {
    for (const rule of OPERATOR_RULES) {
      expect(rule.prefix?.length || rule.contains?.length || rule.norad?.length).toBeTruthy()
    }
  })
})

describe('operatorTitle', () => {
  it('labels known slugs and passes unknown ones through', () => {
    expect(operatorTitle('telepix', 'ko')).toBe('TELEPIX')
    expect(operatorTitle('si', 'ko')).toBe('SI (쎄트렉아이)')
    expect(operatorTitle('si', 'en')).toBe('SI (Satrec Initiative)')
    expect(operatorTitle('kari', 'en')).toBe('KARI')
    expect(operatorTitle('notes', 'en')).toBe('notes')
  })
})

describe('isDebrisName', () => {
  it('matches the backend debris markers', () => {
    expect(isDebrisName('TRANSPORTER-10 OBJECT AD')).toBe(true)
    expect(isDebrisName('RS-44 & BREEZE-KM R/B')).toBe(true)
    expect(isDebrisName('ISS (ZARYA)')).toBe(false)
  })
})
