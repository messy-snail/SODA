import { describe, expect, it } from 'vitest'
import { interpolateTrack, splitAtWindow } from './passTrack'

const track = [0, 0, 0, 10, 20, 30, 20, 40, 60]

describe('interpolateTrack', () => {
  it('returns the ends at AOS and LOS', () => {
    expect(interpolateTrack(track, 1000, 3000, 1000)).toEqual([0, 0, 0])
    expect(interpolateTrack(track, 1000, 3000, 3000)).toEqual([20, 40, 60])
  })

  it('interpolates linearly between evenly spaced samples', () => {
    expect(interpolateTrack(track, 1000, 3000, 1500)).toEqual([5, 10, 15])
    expect(interpolateTrack(track, 1000, 3000, 2500)).toEqual([15, 30, 45])
  })

  it('is null outside the pass or without samples', () => {
    expect(interpolateTrack(track, 1000, 3000, 999)).toBeNull()
    expect(interpolateTrack(track, 1000, 3000, 3001)).toBeNull()
    expect(interpolateTrack([], 1000, 3000, 2000)).toBeNull()
  })
})

describe('splitAtWindow', () => {
  // 11 samples, one per 100 ms from 0 to 1000.
  it('keeps a pass inside the window whole', () => {
    expect(splitAtWindow(11, 0, 1000, -5000, 5000)).toEqual({
      before: null,
      inside: [0, 10],
      after: null,
    })
  })

  it('splits off the part before the window opened', () => {
    expect(splitAtWindow(11, 0, 1000, 300, 5000)).toEqual({
      before: [0, 3],
      inside: [3, 10],
      after: null,
    })
  })

  it('splits off both ends when the pass outlasts the window', () => {
    expect(splitAtWindow(11, 0, 1000, 200, 700)).toEqual({
      before: [0, 2],
      inside: [2, 7],
      after: [7, 10],
    })
  })
})
