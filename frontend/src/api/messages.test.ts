import { describe, expect, it } from 'vitest'
import { ApiError } from './client'
import { apiErrorText, warningText, warningTexts } from './messages'

const t = (key: string, params: Record<string, unknown> = {}) =>
  key === 'warnings.elementsStale'
    ? `Elements are ${params.days} days old`
    : key === 'errors.stationNotFound'
      ? 'Ground station not found'
      : key

describe('warningText', () => {
  it('passes a plain string through', () => {
    expect(warningText('궤도요소가 오래됐습니다')).toBe('궤도요소가 오래됐습니다')
  })

  it('falls back to the server text when there is no translator', () => {
    expect(warningText({ code: 'elementsStale', message: '5일 지났습니다' })).toBe('5일 지났습니다')
  })

  it('translates by code with parameters', () => {
    const warning = { code: 'elementsStale', message: '5일 지났습니다', params: { days: 5 } }
    expect(warningText(warning, t)).toBe('Elements are 5 days old')
  })

  it('keeps the server text when the key is missing', () => {
    expect(warningText({ code: 'brandNew', message: '새 경고' }, t)).toBe('새 경고')
  })
})

describe('warningTexts', () => {
  it('deduplicates rendered lines from several responses', () => {
    const stale = { code: 'elementsStale', message: '5일 지났습니다', params: { days: 5 } }
    expect(warningTexts([stale, stale, '다른 경고'], t)).toEqual([
      'Elements are 5 days old',
      '다른 경고',
    ])
  })
})

describe('apiErrorText', () => {
  it('translates a coded ApiError', () => {
    const error = new ApiError('지상국 없음', 404, 'stationNotFound', { ids: [9] })
    expect(apiErrorText(error, t)).toBe('Ground station not found')
    expect(apiErrorText(error)).toBe('지상국 없음')
  })

  it('uses the message when the server sent no code', () => {
    expect(apiErrorText(new ApiError('그대로', 422), t)).toBe('그대로')
  })

  it('handles values that are not ApiError', () => {
    expect(apiErrorText(new Error('boom'))).toBe('boom')
    expect(apiErrorText('boom')).toBe('boom')
  })
})
