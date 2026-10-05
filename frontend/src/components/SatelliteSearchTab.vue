<template>
  <div class="form-stack">
    <v-text-field
      v-model="query"
      :label="t('catalog.query')"
      placeholder="ISS, SENTINEL, 25544"
      clearable
      autofocus
      data-testid="satellite-query"
      @keydown.enter="lookupNumber"
    >
      <template #prepend-inner><Search :size="16" aria-hidden="true" /></template>
    </v-text-field>
    <template v-if="!query">
      <section v-for="shelf in shelves" :key="shelf.id" class="shelf">
        <p class="section-label">
          <component :is="shelf.icon" :size="12" aria-hidden="true" />{{ shelf.title }}
        </p>
        <div class="picks">
          <v-chip
            v-for="item in shelf.picks"
            :key="item.key"
            :color="inBasket(item.key) ? 'primary' : undefined"
            :data-testid="`pick-${item.key}`"
            @click="togglePick(item)"
          >
            <SquareCheck v-if="inBasket(item.key)" :size="13" class="mr-1" aria-hidden="true" />
            {{ item.name }}
          </v-chip>
        </div>
      </section>
    </template>

    <div class="orbit-filter" data-testid="orbit-filter">
      <span class="section-label filter-label">
        <ListFilter :size="12" aria-hidden="true" />{{ t('catalog.orbitFilter') }}
      </span>
      <v-chip-group
        v-model="categories"
        multiple
        selected-class="text-primary"
        :aria-label="t('catalog.orbitFilter')"
      >
        <v-chip
          v-for="item in ORBIT_CATEGORIES"
          :key="item"
          :value="item"
          filter
          variant="outlined"
          size="small"
          :data-testid="`orbit-filter-${item}`"
        >
          {{ item }}
        </v-chip>
      </v-chip-group>
    </div>

    <v-progress-linear v-if="searching" indeterminate color="primary" height="2" />
    <p v-if="searchError" class="text-error text-caption">{{ searchError }}</p>

    <template v-if="query || categories.length">
      <section v-for="group in knownMatches" :key="group.id" class="matches">
        <p class="section-label">
          <component :is="group.icon" :size="12" aria-hidden="true" />{{ group.title }}
        </p>
        <SatelliteRow
          v-for="item in group.picks"
          :key="item.key"
          :sat-ref="parseSatKey(item.key)!"
          :name="item.name"
          :detail="
            item.key.startsWith('custom:')
              ? t('catalog.userElements')
              : `NORAD ${parseSatKey(item.key)!.noradId}`
          "
        />
      </section>
      <section v-if="freshResults.length" class="matches" data-testid="search-results">
        <p v-if="knownMatches.length" class="section-label">{{ t('catalog.results') }}</p>
        <div class="results">
          <SatelliteRow
            v-for="item in freshResults"
            :key="item.norad_id"
            :sat-ref="{ noradId: item.norad_id, customId: null }"
            :name="item.name"
            :detail="`NORAD ${item.norad_id} · ${item.object_id || '—'}`"
            :category="item.category"
          />
        </div>
      </section>
      <div v-else-if="!searching && !knownMatches.length" class="empty-hint">
        {{ t('catalog.notCached') }}
        <template v-if="numericQuery">
          <br />
          <v-btn class="mt-2" size="small" variant="tonal" color="primary" @click="lookupNumber">
            {{ t('catalog.fetchByCatnr', { norad: numericQuery }) }}
          </v-btn>
        </template>
        <template v-else-if="query"><br />{{ t('catalog.needNumber') }}</template>
      </div>
      <p v-if="results.length >= LIMIT" class="field-note">
        {{ t('catalog.limited', { count: LIMIT }) }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Clock3, ListFilter, Search, Sparkles, SquareCheck, Star } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { apiErrorText } from '../api/messages'
import type { Category, SearchResult } from '../api/types'
import { ORBIT_CATEGORIES, loadOrbitFilter, saveOrbitFilter } from '../catalog/orbitFilter'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import {
  SUGGESTED_PICKS,
  useSatellitePicksStore,
  type SatellitePick,
} from '../stores/satellitePicks'
import { parseSatKey } from '../utils/satelliteRef'
import SatelliteRow from './SatelliteRow.vue'

const LIMIT = 100

const { t } = useI18n()
const basket = useSatelliteBasketStore()
const picks = useSatellitePicksStore()
const query = ref('')
const categories = ref<Category[]>(loadOrbitFilter())
const results = ref<SearchResult[]>([])
const searching = ref(false)
const searchError = ref('')
let timer: ReturnType<typeof setTimeout> | undefined

function inBasket(key: string) {
  const ref = parseSatKey(key)
  return !!ref && basket.has(ref)
}

function togglePick(item: SatellitePick) {
  const ref = parseSatKey(item.key)
  if (ref) basket.toggle(ref, item.name)
}

/** Starred, then recent picks; suggestions stand in until there is any history. */
const shelves = computed(() => {
  const list = []
  if (picks.favorites.length)
    list.push({
      id: 'favorites',
      title: t('catalog.favorites'),
      icon: Star,
      picks: picks.favorites,
    })
  if (picks.recent.length)
    list.push({ id: 'recent', title: t('catalog.recent'), icon: Clock3, picks: picks.recent })
  if (!list.length)
    list.push({
      id: 'suggested',
      title: t('catalog.suggested'),
      icon: Sparkles,
      picks: SUGGESTED_PICKS,
    })
  return list
})

/** Starred and recent satellites whose name matches what is typed, shown ahead of the rest. */
const knownMatches = computed(() => {
  const text = query.value?.trim().toLowerCase()
  if (!text) return []
  const matches = (list: readonly SatellitePick[]) =>
    list.filter((item) => item.name.toLowerCase().includes(text) || item.key.endsWith(`:${text}`))
  const favorites = matches(picks.favorites)
  const recent = matches(picks.recent).filter(
    (item) => !favorites.some((fav) => fav.key === item.key),
  )
  return [
    { id: 'favorites', title: t('catalog.favorites'), icon: Star, picks: favorites },
    { id: 'recent', title: t('catalog.recent'), icon: Clock3, picks: recent },
  ].filter((group) => group.picks.length)
})

/** Search results not already listed among the starred and recent matches. */
const freshResults = computed(() => {
  const known = new Set(knownMatches.value.flatMap((group) => group.picks.map((item) => item.key)))
  return results.value.filter((item) => !known.has(`norad:${item.norad_id}`))
})

const numericQuery = computed(() =>
  /^\d{1,9}$/.test(query.value?.trim() ?? '') ? query.value.trim() : '',
)

watch(categories, saveOrbitFilter)

watch(
  [query, categories],
  ([value, orbit]) => {
    clearTimeout(timer)
    searchError.value = ''
    const text = value?.trim() ?? ''
    if (!text && !orbit.length) {
      results.value = []
      return
    }
    timer = setTimeout(async () => {
      searching.value = true
      try {
        results.value = await api.search(text, LIMIT, { categories: orbit })
      } catch (error) {
        searchError.value = apiErrorText(error, t)
      } finally {
        searching.value = false
      }
    }, 250)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearTimeout(timer))

function lookupNumber() {
  if (numericQuery.value) basket.add({ noradId: Number(numericQuery.value), customId: null })
}
</script>

<style scoped>
.orbit-filter {
  display: grid;
  gap: 2px;
}
.orbit-filter .v-chip-group {
  padding: 0;
}
.filter-label {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
}
.shelf,
.matches {
  display: grid;
  gap: var(--space-1);
}
.shelf {
  gap: var(--space-2);
}
.shelf .section-label,
.matches .section-label {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
}
.picks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.results {
  display: grid;
  gap: 2px;
  max-height: 360px;
  overflow-y: auto;
}
</style>
