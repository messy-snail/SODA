import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GSD_STEPS,
  NO_IMAGERY_FILTER,
  filterImagery,
  gsdLabel,
  sensorCounts,
  MAX_CATALOG_IMPORT_ITEMS,
  MAX_CATALOG_SEARCH_SPAN_DEG,
  MAX_IMAGERY_BYTES,
  escapeHtml,
  groupByDate,
  guessImageryFormat,
  imageryAccept,
  imageryCredit,
  imageryFade,
  imageryFileProblem,
  imageryViewPoint,
  isNonCommercial,
  minimumLevelFor,
  nameFromFile,
  parseCorners,
  planBatch,
  sanitizeImageryPrefs,
} from './imagery'

describe('imagery files', () => {
  it('guesses the format from the extension', () => {
    expect(guessImageryFormat('Seoul.MBTILES')).toBe('mbtiles')
    expect(guessImageryFormat('quicklook.jpeg')).toBe('image')
    expect(guessImageryFormat('scene.tif')).toBe('geotiff')
    expect(guessImageryFormat('notes.txt')).toBeNull()
  })

  it('lists the extensions a format accepts', () => {
    expect(imageryAccept('image')).toBe('.png,.jpg,.jpeg')
  })

  it('accepts a matching file within the size limit', () => {
    expect(imageryFileProblem('geotiff', { name: 'a.tiff', size: 10 })).toBe('')
    expect(imageryFileProblem('mbtiles', { name: 'a.mbtiles', size: MAX_IMAGERY_BYTES })).toBe('')
  })

  it('names the problem with a wrong or oversized file', () => {
    expect(imageryFileProblem('mbtiles', { name: 'a.png', size: 10 })).not.toBe('')
    expect(imageryFileProblem('image', { name: 'a.png', size: MAX_IMAGERY_BYTES + 1 })).not.toBe('')
  })

  it('matches the server limit', () => {
    expect(MAX_IMAGERY_BYTES).toBe(1024 ** 3)
  })

  it('turns a file name into a display name', () => {
    expect(nameFromFile('006-021_S5_293-214-0.jpg')).toBe('006-021_S5_293-214-0')
    expect(nameFromFile('x'.repeat(80) + '.tif')).toHaveLength(60)
  })
})

describe('parseCorners', () => {
  const quad = [126, 37.6, 126.8, 37.75, 126.95, 37.1, 126.15, 36.95]

  it('reads eight numbers however they are separated', () => {
    expect(parseCorners('126, 37.6, 126.8, 37.75, 126.95, 37.1, 126.15, 36.95')).toEqual(quad)
    expect(parseCorners('126 37.6\n126.8 37.75\n126.95 37.1\n126.15 36.95')).toEqual(quad)
  })

  it('reads a closed WKT ring and drops the repeated point', () => {
    const wkt = 'POLYGON ((126 37.6, 126.8 37.75, 126.95 37.1, 126.15 36.95, 126 37.6))'
    expect(parseCorners(wkt)).toEqual(quad)
  })

  it('keeps negative and exponent values', () => {
    expect(parseCorners('-1.5,2,-1e0,2,-1,1,-1.5,1')).toEqual([-1.5, 2, -1, 2, -1, 1, -1.5, 1])
  })

  it('rejects anything that is not four points', () => {
    expect(parseCorners('')).toBeNull()
    expect(parseCorners('1,2,3,4,5,6')).toBeNull()
    expect(parseCorners('1,2,3,4,5,6,7,8,9,10')).toBeNull()
    expect(parseCorners('lon 1 lat 2, 3 4, 5 6, 7 8')).toBeNull()
  })
})

describe('sanitizeImageryPrefs', () => {
  it('keeps well-formed entries and clamps opacity', () => {
    expect(
      sanitizeImageryPrefs({
        'spot5-seoul': { opacity: 0.4 },
        u12ab: { opacity: 7 },
        u34cd: { opacity: 'half' },
      }),
    ).toEqual({
      'spot5-seoul': { opacity: 0.4 },
      u12ab: { opacity: 1 },
      u34cd: { opacity: 1 },
    })
  })

  it('drops malformed ids and values', () => {
    expect(sanitizeImageryPrefs({ '../x': { opacity: 1 }, ok: null, UP: {} })).toEqual({})
    expect(sanitizeImageryPrefs(null)).toEqual({})
    expect(sanitizeImageryPrefs(['a'])).toEqual({})
  })
})

describe('imageryFade', () => {
  // About 84 km wide and 89 km tall, so it starts to appear below 712 km and is full by 445 km.
  const scene = { west_deg: 126, south_deg: 36.95, east_deg: 126.95, north_deg: 37.75 }
  const above = (height_m: number) => ({ lon_deg: 126.475, lat_deg: 37.35, height_m })

  it('is hidden from far above and full once the camera is close', () => {
    expect(imageryFade(scene, above(1_000_000))).toBe(0)
    expect(imageryFade(scene, above(720_000))).toBe(0)
    expect(imageryFade(scene, above(440_000))).toBe(1)
    expect(imageryFade(scene, above(100_000))).toBe(1)
  })

  it('fades in between the two heights', () => {
    const halfway = imageryFade(scene, above(578_000))
    expect(halfway).toBeGreaterThan(0.45)
    expect(halfway).toBeLessThan(0.55)
    expect(imageryFade(scene, above(650_000))).toBeLessThan(halfway)
  })

  it('stays hidden while the camera is low over somewhere else', () => {
    expect(imageryFade(scene, { lon_deg: 2.35, lat_deg: 48.86, height_m: 100_000 })).toBe(0)
    expect(imageryFade(scene, { lon_deg: 129, lat_deg: 35.1, height_m: 100_000 })).toBe(0)
  })

  it('shows beside the set when the camera is high enough to see it at a tilt', () => {
    expect(imageryFade(scene, { lon_deg: 127.6, lat_deg: 37.35, height_m: 300_000 })).toBe(1)
  })

  it('always shows a set that covers the globe', () => {
    const world = { west_deg: -180, south_deg: -85, east_deg: 180, north_deg: 85 }
    expect(imageryFade(world, { lon_deg: 20, lat_deg: 10, height_m: 20_000_000 })).toBe(1)
  })

  it('is 0 for a set that is not ready or a camera that is mid-transition', () => {
    const pending = { west_deg: null, south_deg: null, east_deg: null, north_deg: null }
    expect(imageryFade(pending, above(100_000))).toBe(0)
    expect(imageryFade(scene, above(Number.NaN))).toBe(0)
  })
})

describe('minimumLevelFor', () => {
  const seoul = { west_deg: 126, south_deg: 36.95, east_deg: 126.95, north_deg: 37.75 }

  it('uses the set minimum when it is at most four tiles', () => {
    expect(minimumLevelFor({ ...seoul, min_zoom: 8 })).toBe(8)
  })

  it('falls back to level 0 when the minimum level is wide', () => {
    expect(
      minimumLevelFor({
        west_deg: -180,
        south_deg: -80,
        east_deg: 180,
        north_deg: 80,
        min_zoom: 5,
      }),
    ).toBe(0)
    expect(minimumLevelFor({ ...seoul, min_zoom: 14 })).toBe(0)
  })

  it('is 0 for a set that is not ready', () => {
    expect(
      minimumLevelFor({
        west_deg: null,
        south_deg: null,
        east_deg: null,
        north_deg: null,
        min_zoom: null,
      }),
    ).toBe(0)
  })
})

describe('escapeHtml', () => {
  it('neutralises markup in an attribution', () => {
    expect(escapeHtml('<img src=x onerror="a()"> & co')).toBe(
      '&lt;img src=x onerror=&quot;a()&quot;&gt; &amp; co',
    )
  })
})

describe('planBatch', () => {
  const file = (name: string, size = 10) => ({ name, size }) as File

  it('takes georeferenced files as they are and names them after the file', () => {
    const [tif, tiles] = planBatch([file('seoul_2024.tif'), file('Mosaic.MBTILES')])
    expect(tif).toMatchObject({ format: 'geotiff', name: 'seoul_2024', problem: '' })
    expect(tiles).toMatchObject({ format: 'mbtiles', name: 'Mosaic', problem: '' })
  })

  it('leaves out what a batch cannot register', () => {
    const [image, text, huge] = planBatch([
      file('quicklook.jpg'),
      file('notes.txt'),
      file('big.tif', MAX_IMAGERY_BYTES + 1),
    ])
    // An image needs corners typed in, so it is not part of a batch.
    expect(image!.format).toBe('image')
    expect(image!.problem).not.toBe('')
    expect(text!.format).toBeNull()
    expect(text!.problem).not.toBe('')
    expect(huge!.problem).not.toBe('')
  })
})

describe('imageryViewPoint', () => {
  it('puts the camera where a set of any size is fully shown', () => {
    for (const span of [0.005, 0.05, 0.5, 5]) {
      const item = { west_deg: 127, south_deg: 37, east_deg: 127 + span, north_deg: 37 + span }
      const point = imageryViewPoint(item)!
      expect(point.lon_deg).toBeCloseTo(127 + span / 2)
      expect(point.lat_deg).toBeCloseTo(37 + span / 2)
      expect(imageryFade(item, point)).toBe(1)
    }
  })

  it('has nowhere to go for a set that is not ready', () => {
    expect(
      imageryViewPoint({ west_deg: null, south_deg: null, east_deg: null, north_deg: null }),
    ).toBeNull()
  })
})

describe('licence helpers', () => {
  it('spots the non-commercial Creative Commons licences', () => {
    expect(isNonCommercial('CC BY-NC 4.0')).toBe(true)
    expect(isNonCommercial('CC-BY-NC-4.0')).toBe(true)
    expect(isNonCommercial('CC BY 4.0')).toBe(false)
    expect(isNonCommercial('')).toBe(false)
    // "nc" inside a word is not the licence clause.
    expect(isNonCommercial('Open Licence 2.0 (France)')).toBe(false)
  })

  it('builds the credit from attribution and licence, escaped', () => {
    expect(imageryCredit({ attribution: 'Maxar', license: 'CC BY-NC 4.0' })).toBe(
      'Maxar · CC BY-NC 4.0',
    )
    expect(imageryCredit({ attribution: '', license: 'CC BY 4.0' })).toBe('CC BY 4.0')
    expect(imageryCredit({ attribution: '<b>x</b>', license: '' })).toBe('&lt;b&gt;x&lt;/b&gt;')
    expect(imageryCredit({ attribution: '', license: '' })).toBe('')
  })
})

describe('limits mirrored from the backend', () => {
  // Vite refuses to import a file outside its root, so the Python module is read as text.
  const source = readFileSync(resolve(process.cwd(), '../src/soda/imagery/limits.py'), 'utf8')
  const backend = (name: string) => {
    const match = source.match(new RegExp(`^${name} = (.+)$`, 'm'))
    if (!match) throw new Error(`limits.py no longer declares ${name}`)
    // The values are plain products such as 1024 * 1024 * 1024.
    return match[1]!.split('*').reduce((product, factor) => product * Number(factor), 1)
  }

  it('match limits.py', () => {
    expect(MAX_IMAGERY_BYTES).toBe(backend('MAX_IMAGERY_BYTES'))
    expect(MAX_CATALOG_IMPORT_ITEMS).toBe(backend('MAX_CATALOG_IMPORT_ITEMS'))
    expect(MAX_CATALOG_SEARCH_SPAN_DEG).toBe(backend('MAX_CATALOG_SEARCH_SPAN_DEG'))
  })
})

describe('groupByDate', () => {
  const item = (id: string, acquired_at: string | null) => ({ id, acquired_at })

  it('sorts results into dates, newest first, keeping the order inside a date', () => {
    const groups = groupByDate([
      item('a', '2025-01-16T18:40:00Z'),
      item('b', '2025-01-20T18:32:43Z'),
      item('c', '2025-01-16T00:00:00Z'),
      item('d', '2025-01-20T18:32:42Z'),
    ])
    expect(groups.map((group) => [group.date, group.items.map((entry) => entry.id)])).toEqual([
      ['2025-01-20', ['b', 'd']],
      ['2025-01-16', ['a', 'c']],
    ])
    expect(groups.map((group) => group.key)).toEqual(['2025-01-20', '2025-01-16'])
  })

  it('puts items without a usable date last, in one group', () => {
    const groups = groupByDate([item('a', null), item('b', '2024-11-09'), item('c', 'soon')])
    expect(groups.map((group) => [group.date, group.items.length])).toEqual([
      ['2024-11-09', 1],
      [null, 2],
    ])
    expect(groups[1]!.key).toBe('undated')
  })

  it('has no groups for no results', () => {
    expect(groupByDate([])).toEqual([])
  })
})

describe('gsdLabel', () => {
  it('reads the way a resolution is said', () => {
    expect([0.3, 0.35, 0.5, 0.911, 1, 1.04, 4.97, 5, 12.34, 156329].map(gsdLabel)).toEqual([
      '0.3 m',
      '0.35 m',
      '0.5 m',
      '0.91 m',
      '1 m',
      '1 m',
      '5 m',
      '5 m',
      '12.3 m',
      '156329 m',
    ])
  })
})

describe('filterImagery', () => {
  const set = (id: string, sensor: 'optical' | 'sar' | null, gsd_m: number | null) =>
    ({ id, status: 'ready', sensor, gsd_m }) as const
  const items = [
    set('paris', 'optical', 0.3),
    set('wajima', 'optical', 0.5),
    set('busan', 'optical', 1),
    set('spot', 'optical', 5),
    set('seoul', 'sar', 0.2),
    set('incheon', 'sar', 0.9),
    set('mine', null, 12),
    { id: 'importing', status: 'processing', sensor: null, gsd_m: null } as const,
    { id: 'broken', status: 'failed', sensor: 'sar', gsd_m: null } as const,
  ]
  const ids = (sensor: 'optical' | 'sar' | null, maxGsd: number | null) =>
    filterImagery(items, { sensor, maxGsd }).map((item) => item.id)
  const unfinished = ['importing', 'broken']

  it('keeps everything when nothing is asked for', () => {
    expect(filterImagery(items, NO_IMAGERY_FILTER)).toEqual(items)
  })

  it('narrows by sensor, leaving out sets that do not say', () => {
    expect(ids('sar', null)).toEqual(['seoul', 'incheon', ...unfinished])
    expect(ids('optical', null)).toEqual(['paris', 'wajima', 'busan', 'spot', ...unfinished])
  })

  it('keeps sets as sharp as the step or sharper, the step itself included', () => {
    expect(ids(null, 0.5)).toEqual(['paris', 'wajima', 'seoul', ...unfinished])
    expect(ids(null, 1)).toEqual(['paris', 'wajima', 'busan', 'seoul', 'incheon', ...unfinished])
    expect(ids(null, 5)).not.toContain('mine')
    expect(ids(null, 5)).toContain('spot')
  })

  it('applies both at once', () => {
    expect(ids('sar', 0.5)).toEqual(['seoul', ...unfinished])
  })

  it('never hides an import that is running or failed', () => {
    expect(ids('optical', 0.5)).toEqual(expect.arrayContaining(unfinished))
  })

  it('offers steps in rising order', () => {
    expect([...GSD_STEPS]).toEqual([...GSD_STEPS].sort((a, b) => a - b))
  })

  it('counts ready sets per sensor', () => {
    expect(sensorCounts(items)).toEqual({ optical: 4, sar: 2 })
  })
})
