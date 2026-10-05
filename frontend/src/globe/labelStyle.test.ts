import { describe, expect, it } from 'vitest'
import { crispLabel } from './labelStyle'

describe('crispLabel', () => {
  it('draws at twice the size and shows it at half scale', () => {
    expect(crispLabel(12)).toEqual({
      font: '600 24px "Pretendard Variable", sans-serif',
      scale: 0.5,
      outlineWidth: 6,
    })
    expect(crispLabel(14, 700, 2)).toMatchObject({ font: expect.stringMatching(/^700 28px/) })
  })
})
