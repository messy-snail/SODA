import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import { api } from '../api/client'
import type { CatalogDetail } from '../api/types'
import { customKind, parseSatKey, satKey, type SatelliteRef } from '../utils/satelliteRef'
import { MAX_BASKET, toggledEntry, withEntry, withoutEntry, type BasketEntry } from './basketItems'
import { useSatellitePicksStore } from './satellitePicks'

export interface BasketItem extends BasketEntry {
  ref: SatelliteRef
}

/**
 * Satellites picked for the next propagation. Each propagates into a run of its own; their
 * details (orbit, epoch, TLE) load on demand and are cached by key for the rows that show them.
 */
export const useSatelliteBasketStore = defineStore('satelliteBasket', () => {
  const entries = ref<BasketEntry[]>([])
  const details = shallowRef(new Map<string, CatalogDetail>())
  const errors = shallowRef(new Map<string, string>())
  const pending = new Map<string, Promise<CatalogDetail | null>>()
  /** Set briefly when a pick was refused because the basket is full. */
  const refusedFull = ref(false)

  const items = computed<BasketItem[]>(() =>
    entries.value.map((entry) => ({ ...entry, ref: parseSatKey(entry.key)! })),
  )
  /** The satellite single-satellite views fall back to (pass target, logo slot). */
  const focus = computed(() => items.value[0] ?? null)
  const full = computed(() => entries.value.length >= MAX_BASKET)

  function has(ref: SatelliteRef): boolean {
    const key = satKey(ref)
    return entries.value.some((entry) => entry.key === key)
  }

  function remember(key: string, detail: CatalogDetail) {
    details.value = new Map(details.value).set(key, markRaw(detail))
    // The pick may have been made from a bare key; the loaded name is the real one.
    entries.value = entries.value.map((entry) =>
      entry.key === key ? { ...entry, name: detail.name } : entry,
    )
  }

  function fetchDetail(ref: SatelliteRef): Promise<CatalogDetail> {
    const kind = customKind(ref)
    if (kind === 'state') return api.customState(ref.customId!)
    if (kind === 'ephemeris') return api.customEphemeris(ref.customId!)
    return kind === 'elements' ? api.customElement(ref.customId!) : api.catalog(ref.noradId)
  }

  /** Loads (once) and returns a satellite's details; null when that failed. */
  function loadDetail(ref: SatelliteRef): Promise<CatalogDetail | null> {
    const key = satKey(ref)
    const known = details.value.get(key)
    if (known) return Promise.resolve(known)
    let request = pending.get(key)
    if (!request) {
      request = fetchDetail(ref)
        .then((detail) => {
          remember(key, detail)
          const next = new Map(errors.value)
          next.delete(key)
          errors.value = next
          return detail
        })
        .catch((caught: unknown) => {
          errors.value = new Map(errors.value).set(
            key,
            caught instanceof Error ? caught.message : String(caught),
          )
          return null
        })
        .finally(() => pending.delete(key))
      pending.set(key, request)
    }
    return request
  }

  function apply(
    change: { list: BasketEntry[]; added: boolean; full: boolean },
    ref: SatelliteRef,
  ) {
    entries.value = change.list
    refusedFull.value = change.full
    if (change.added) {
      // Noted under the loaded name: a pick from the globe or a number only knows the NORAD id.
      void loadDetail(ref).then((detail) => {
        if (detail) useSatellitePicksStore().noteRecent(ref, detail.name)
      })
    }
    return change.added
  }

  /** Adds a satellite; false when it was there already or the basket is full. */
  function add(ref: SatelliteRef, name = `NORAD ${ref.noradId}`): boolean {
    return apply(withEntry(entries.value, { key: satKey(ref), name }), ref)
  }

  function toggle(ref: SatelliteRef, name = `NORAD ${ref.noradId}`): void {
    apply(toggledEntry(entries.value, { key: satKey(ref), name }), ref)
  }

  function remove(ref: SatelliteRef) {
    entries.value = withoutEntry(entries.value, satKey(ref))
    refusedFull.value = false
  }

  function clear() {
    entries.value = []
    refusedFull.value = false
  }

  /** Puts back a basket saved by key (session restore), loading each detail again. */
  function restore(keys: readonly string[]) {
    for (const key of keys) {
      const ref = parseSatKey(key)
      if (ref && !has(ref)) {
        entries.value = withEntry(entries.value, { key, name: key }).list
        void loadDetail(ref)
      }
    }
  }

  function detailOf(ref: SatelliteRef): CatalogDetail | null {
    return details.value.get(satKey(ref)) ?? null
  }

  function errorOf(ref: SatelliteRef): string | null {
    return errors.value.get(satKey(ref)) ?? null
  }

  return {
    entries,
    items,
    focus,
    full,
    refusedFull,
    has,
    add,
    toggle,
    remove,
    clear,
    restore,
    loadDetail,
    detailOf,
    errorOf,
  }
})
