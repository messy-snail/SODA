/** Prefix of every browser-storage key SODA writes (`soda.layout`, `soda.sensor.<ref>`, ...). */
export const STORAGE_PREFIX = 'soda.'

type StorageLike = Pick<Storage, 'length' | 'key' | 'removeItem'>

let suspended = false

/** True once a reset has started; savers skip writing so the reload starts clean. */
export function persistenceSuspended(): boolean {
  return suspended
}

/**
 * Remove every `soda.*` key from the given storages. Server data is not touched.
 *
 * Args:
 *   storages: Usually `localStorage` and `sessionStorage`.
 *
 * Returns:
 *   The removed keys, in the order found.
 */
export function clearSodaKeys(storages: readonly StorageLike[]): string[] {
  const removed: string[] = []
  for (const storage of storages) {
    try {
      const keys: string[] = []
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key?.startsWith(STORAGE_PREFIX)) keys.push(key)
      }
      for (const key of keys) storage.removeItem(key)
      removed.push(...keys)
    } catch {
      // Blocked storage (private mode, site data disabled) has nothing to clear.
    }
  }
  return removed
}

function browserStorages(): StorageLike[] {
  const found: StorageLike[] = []
  for (const get of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      found.push(get())
    } catch {
      // Accessing a blocked storage throws; skip it.
    }
  }
  return found
}

/** Clear all browser-side SODA settings and reload the page with defaults. */
export function resetClientState(): void {
  suspended = true
  clearSodaKeys(browserStorages())
  window.location.reload()
}
