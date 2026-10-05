import { useI18n } from 'vue-i18n'
import { relativeSpan, splitDuration } from './time'

/**
 * Wording for the two duration helpers.
 *
 * The arithmetic stays in `time.ts` and only the phrasing lives here, so English plurals
 * are vue-i18n's problem rather than a branch in the maths.
 */
export function useTimeText() {
  const { t } = useI18n()

  function formatDuration(seconds: number): string {
    const parts = splitDuration(seconds)
    return t(`time.duration.${parts.unit}`, { ...parts })
  }

  function formatAgo(ms: number, now = Date.now()): string {
    const span = relativeSpan(ms, now)
    if (span.unit === 'now') return t('time.ago.now')
    return t(`time.ago.${span.unit}`, { ...span }, span.count)
  }

  return { formatDuration, formatAgo }
}
