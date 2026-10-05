<template>
  <div class="form-stack">
    <div class="source-row">
      <v-btn-toggle
        v-model="catalog.source"
        class="segmented"
        :aria-label="t('imagery.catalog.source')"
      >
        <v-btn value="maxar" data-testid="imagery-catalog-maxar">Maxar Open Data</v-btn>
        <v-btn value="oam" data-testid="imagery-catalog-oam">OpenAerialMap</v-btn>
      </v-btn-toggle>
      <!-- What the chosen catalogue holds and under which licence, on demand. -->
      <InfoTip :label="t('imagery.catalog.source')">
        {{ t(`imagery.catalog.about.${catalog.source}`) }}
      </InfoTip>
    </div>
    <v-btn
      variant="tonal"
      color="primary"
      size="small"
      :loading="catalog.loading"
      :disabled="!catalog.searchable"
      data-testid="imagery-catalog-search"
      @click="search"
    >
      <Search :size="14" class="mr-1" aria-hidden="true" />{{ t('imagery.catalog.search') }}
    </v-btn>
    <p v-if="!catalog.searchable" class="field-note">{{ t('imagery.catalog.zoomIn') }}</p>
    <p v-if="catalog.error" class="text-error text-caption message">{{ catalog.error }}</p>

    <template v-if="catalog.found !== null">
      <p v-if="!catalog.results.length" class="empty-hint">{{ t('imagery.catalog.none') }}</p>
      <template v-else>
        <!-- One chip per acquisition date: the same ground is often imaged several times. -->
        <v-chip-group
          v-if="groups.length > 1"
          v-model="shownDate"
          class="dates"
          :aria-label="t('imagery.catalog.dates')"
          data-testid="imagery-catalog-dates"
        >
          <v-chip :value="ALL" filter>{{ t('imagery.catalog.allDates') }}</v-chip>
          <v-chip v-for="group in groups" :key="group.key" :value="group.key" filter>
            {{ group.date ?? t('imagery.catalog.undated') }} · {{ group.items.length }}
          </v-chip>
        </v-chip-group>
        <div class="results" data-testid="imagery-catalog-results">
          <section v-for="group in shownGroups" :key="group.key" class="group">
            <header class="group-head">
              <v-checkbox-btn
                :model-value="groupState(group) === 'all'"
                :indeterminate="groupState(group) === 'some'"
                :disabled="!pickable(group).length"
                :aria-label="
                  t('imagery.catalog.pickDate', {
                    date: group.date ?? t('imagery.catalog.undated'),
                  })
                "
                density="compact"
                @update:model-value="
                  catalog.setSelected(
                    pickable(group).map((item) => item.item_id),
                    groupState(group) !== 'all',
                  )
                "
              />
              <strong>{{ group.date ?? t('imagery.catalog.undated') }}</strong>
              <small>{{ groupFacts(group) }}</small>
            </header>
            <ul>
              <li v-for="item in group.items" :key="item.item_id" class="result">
                <v-checkbox-btn
                  :model-value="catalog.selected.includes(item.item_id)"
                  :disabled="!item.importable || catalog.isImported(item)"
                  :aria-label="t('imagery.catalog.pick', { name: item.title })"
                  density="compact"
                  @update:model-value="catalog.toggle(item.item_id)"
                />
                <span class="grow">
                  <strong>{{ item.title }}</strong>
                  <small>{{ facts(item) }}</small>
                  <small v-if="catalog.isImported(item)" class="state">
                    {{ t('imagery.catalog.imported') }}
                  </small>
                  <small v-else-if="!item.importable" class="text-warning">
                    {{ t(`imagery.catalog.reason.${item.reason}`) }}
                  </small>
                </span>
                <v-btn
                  icon
                  size="x-small"
                  variant="text"
                  :aria-label="t('imagery.flyTo', { name: item.title })"
                  :title="t('imagery.flyTo', { name: item.title })"
                  @click="goTo(item)"
                >
                  <LocateFixed :size="15" />
                </v-btn>
              </li>
            </ul>
          </section>
        </div>
      </template>
      <p v-if="catalog.truncated" class="field-note">{{ t('imagery.catalog.truncated') }}</p>
      <p v-if="catalog.selected.length >= MAX_CATALOG_IMPORT_ITEMS" class="field-note">
        {{ t('imagery.catalog.limit', { max: MAX_CATALOG_IMPORT_ITEMS }) }}
      </p>
      <v-btn
        v-if="catalog.results.length"
        variant="tonal"
        color="primary"
        size="small"
        :loading="catalog.importing"
        :disabled="!catalog.selected.length"
        data-testid="imagery-catalog-import"
        @click="importSelected"
      >
        <Download :size="14" class="mr-1" aria-hidden="true" />
        {{ t('imagery.catalog.import', { count: catalog.selected.length }) }}
      </v-btn>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Download, LocateFixed, Search } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ImageryCandidate } from '../api/types'
import { useImageryCatalogStore } from '../stores/imageryCatalog'
import { usePlacesStore } from '../stores/places'
import {
  MAX_CATALOG_IMPORT_ITEMS,
  groupByDate,
  gsdLabel,
  imageryViewPoint,
  isNonCommercial,
  type DateGroup,
} from '../utils/imagery'
import { formatBytes } from '../utils/namedFiles'
import InfoTip from './InfoTip.vue'

/**
 * Search the public catalogues for the area in view, tick results, and import them. Results
 * are sorted into acquisition dates, since a place is usually covered more than once and the
 * date is what tells the passes apart.
 */
const { t } = useI18n()
const catalog = useImageryCatalogStore()
const places = usePlacesStore()

const ALL = 'all'
type Group = DateGroup<ImageryCandidate>
/** Which date's results are listed; `ALL` lists every date under its own heading. */
const shownDate = ref<string>(ALL)

const groups = computed(() => groupByDate(catalog.results))
const shownGroups = computed(() =>
  shownDate.value === ALL
    ? groups.value
    : groups.value.filter((group) => group.key === shownDate.value),
)

function search() {
  shownDate.value = ALL
  void catalog.search()
}

/** The items of a group that can still be ticked. */
function pickable(group: Group): ImageryCandidate[] {
  return group.items.filter((item) => item.importable && !catalog.isImported(item))
}

function groupState(group: Group): 'none' | 'some' | 'all' {
  const items = pickable(group)
  const picked = items.filter((item) => catalog.selected.includes(item.item_id)).length
  if (!picked) return 'none'
  return picked === items.length ? 'all' : 'some'
}

/** What a date's results have in common: how many, and how sharp where that is known. */
function groupFacts(group: Group): string {
  const parts = [t('imagery.catalog.count', { count: group.items.length })]
  const known = group.items.map((item) => item.gsd_m).filter((gsd) => gsd !== null)
  if (known.length) parts.push(gsdLabel(Math.min(...known)))
  return parts.join(' · ')
}

/** One line of what is known about a result; a search does not look every item up. */
function facts(item: ImageryCandidate): string {
  const parts: string[] = []
  if (item.gsd_m !== null) parts.push(t('imagery.catalog.gsd', { value: gsdLabel(item.gsd_m) }))
  if (item.clouds_percent !== null) {
    parts.push(t('imagery.catalog.clouds', { percent: Math.round(item.clouds_percent) }))
  }
  if (item.size_bytes !== null) parts.push(formatBytes(item.size_bytes))
  if (item.license) parts.push(item.license)
  return parts.join(' · ')
}

function goTo(item: ImageryCandidate) {
  const point = imageryViewPoint(item)
  if (point) places.flyToPoint(point)
}

function importSelected() {
  const picked = catalog.results.filter((item) => catalog.selected.includes(item.item_id))
  const licences = [...new Set(picked.map((item) => item.license).filter(isNonCommercial))]
  if (
    licences.length &&
    !confirm(t('imagery.catalog.confirmNc', { license: licences.join(', ') }))
  ) {
    return
  }
  void catalog.importItems(catalog.source, [...catalog.selected])
}
</script>

<style scoped>
.source-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.source-row .segmented {
  flex: 1;
  min-width: 0;
}
.dates {
  padding: 0;
}
.results {
  display: grid;
  gap: var(--space-2);
  max-height: 300px;
  overflow-y: auto;
}
.group ul {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.group-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  background: rgb(var(--v-theme-surface));
  font-size: 12px;
}
.group-head small {
  color: rgb(var(--v-theme-secondary));
  font-size: 11px;
}
.result {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px 4px 0;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
/* Vuetify lets a selection control grow; here it is only the box. */
.results :deep(.v-selection-control) {
  flex: none;
}
.grow {
  flex: 1;
  min-width: 0;
}
.grow strong {
  display: block;
  overflow: hidden;
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grow small {
  display: block;
  overflow: hidden;
  font-size: 11px;
  color: rgb(var(--v-theme-secondary));
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grow small.state {
  color: rgb(var(--v-theme-primary));
}
.message {
  margin: 0;
}
</style>
