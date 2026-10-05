/** Most satellites one propagation batch takes; each becomes a run of its own. */
export const MAX_BASKET = 8

export interface BasketEntry {
  key: string
  name: string
}

export type BasketChange = { list: BasketEntry[]; added: boolean; full: boolean }

/** Adds `entry` at the end unless it is there already or the basket is full. */
export function withEntry(list: readonly BasketEntry[], entry: BasketEntry): BasketChange {
  if (list.some((item) => item.key === entry.key))
    return { list: [...list], added: false, full: false }
  if (list.length >= MAX_BASKET) return { list: [...list], added: false, full: true }
  return { list: [...list, entry], added: true, full: false }
}

export function withoutEntry(list: readonly BasketEntry[], key: string): BasketEntry[] {
  return list.filter((item) => item.key !== key)
}

/** Removes `entry` when present, adds it otherwise. */
export function toggledEntry(list: readonly BasketEntry[], entry: BasketEntry): BasketChange {
  return list.some((item) => item.key === entry.key)
    ? { list: withoutEntry(list, entry.key), added: false, full: false }
    : withEntry(list, entry)
}
