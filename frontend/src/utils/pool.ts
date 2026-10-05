/**
 * Run `task` over every item, at most `limit` at a time, in order of arrival. Stops handing
 * out items once `signal` aborts; a task that throws rejects the whole pool, so tasks that
 * may fail on their own catch inside.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  signal: AbortSignal,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0
  async function worker() {
    while (next < items.length && !signal.aborted) {
      const index = next++
      await task(items[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
