/**
 * How far SGP4 output can be trusted, judged by the distance between a time and the element
 * set epoch. LEO errors grow by roughly a few kilometres a day either side of the epoch, so
 * the grades are symmetric and step at 3, 7 and 14 days. The 7-day step matches the server's
 * `elementsFarFromEpoch` warning (`orbit/propagator.py` `STALE_AFTER`).
 */

export type TrustLevel = 'ok' | 'caution' | 'low' | 'poor'

export const TRUST_DAYS = { caution: 3, low: 7, poor: 14 } as const
export const TRUST_ORDER: readonly TrustLevel[] = ['ok', 'caution', 'low', 'poor']

const DAY_MS = 86_400_000

/** Signed days from the epoch to `atMs`; negative before the epoch. */
export function daysFromEpoch(epochMs: number, atMs: number): number {
  return (atMs - epochMs) / DAY_MS
}

export function trustLevel(epochMs: number, atMs: number): TrustLevel {
  const days = Math.abs(daysFromEpoch(epochMs, atMs))
  if (days > TRUST_DAYS.poor) return 'poor'
  if (days > TRUST_DAYS.low) return 'low'
  if (days > TRUST_DAYS.caution) return 'caution'
  return 'ok'
}

export function worseLevel(a: TrustLevel, b: TrustLevel): TrustLevel {
  return TRUST_ORDER.indexOf(a) >= TRUST_ORDER.indexOf(b) ? a : b
}

/** The worst grade anywhere in `[startMs, stopMs]`, reached at whichever end is further away. */
export function worstLevel(epochMs: number, startMs: number, stopMs: number): TrustLevel {
  return worseLevel(trustLevel(epochMs, startMs), trustLevel(epochMs, stopMs))
}

/** Largest distance in days between the epoch and either end of the window. */
export function farthestDays(epochMs: number, startMs: number, stopMs: number): number {
  return Math.max(
    Math.abs(daysFromEpoch(epochMs, startMs)),
    Math.abs(daysFromEpoch(epochMs, stopMs)),
  )
}

export interface TrustBand {
  startMs: number
  endMs: number
  level: TrustLevel
}

/** Splits `[startMs, stopMs]` into consecutive bands of one grade each. */
export function trustBands(epochMs: number, startMs: number, stopMs: number): TrustBand[] {
  if (!(stopMs > startMs)) return []
  const edges = [TRUST_DAYS.caution, TRUST_DAYS.low, TRUST_DAYS.poor]
    .flatMap((days) => [epochMs - days * DAY_MS, epochMs + days * DAY_MS])
    .filter((ms) => ms > startMs && ms < stopMs)
    .sort((a, b) => a - b)
  const cuts = [startMs, ...edges, stopMs]
  const bands: TrustBand[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i]!
    const to = cuts[i + 1]!
    const level = trustLevel(epochMs, (from + to) / 2)
    const last = bands.at(-1)
    if (last && last.level === level) last.endMs = to
    else bands.push({ startMs: from, endMs: to, level })
  }
  return bands
}

/** Band opacity as a two-digit hex alpha, stronger the less the elements can be trusted. */
const BAND_ALPHA: Record<Exclude<TrustLevel, 'ok'>, string> = {
  caution: '2e',
  low: '55',
  poor: '80',
}

/**
 * A CSS `linear-gradient` that shades the stretches of `[startMs, stopMs]` that are not `ok`,
 * or `none` when there is nothing to shade. `colors` holds `#rrggbb` per grade.
 */
export function bandsGradient(
  bands: readonly TrustBand[],
  startMs: number,
  stopMs: number,
  colors: Record<Exclude<TrustLevel, 'ok'>, string>,
): string {
  const span = stopMs - startMs
  if (!(span > 0) || bands.every((band) => band.level === 'ok')) return 'none'
  const pct = (ms: number) => {
    const clamped = Math.min(Math.max(ms, startMs), stopMs)
    return `${(((clamped - startMs) / span) * 100).toFixed(3)}%`
  }
  const stops = bands.flatMap((band) => {
    const color =
      band.level === 'ok' ? 'transparent' : `${colors[band.level]}${BAND_ALPHA[band.level]}`
    return [`${color} ${pct(band.startMs)}`, `${color} ${pct(band.endMs)}`]
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
}

export interface TrustSource {
  id: string
  visible: boolean
  epochMs: number
}

/**
 * The run the globe-wide indicators follow: the selected run when there is one, otherwise the
 * visible run whose elements are worst at `atMs`.
 */
export function trustReferenceRun<T extends TrustSource>(
  runs: readonly T[],
  selectedId: string | null,
  atMs: number,
): T | null {
  const selected = runs.find((run) => run.id === selectedId)
  if (selected) return selected
  let best: T | null = null
  for (const run of runs) {
    if (!run.visible) continue
    if (
      !best ||
      Math.abs(daysFromEpoch(run.epochMs, atMs)) > Math.abs(daysFromEpoch(best.epochMs, atMs))
    )
      best = run
  }
  return best
}
