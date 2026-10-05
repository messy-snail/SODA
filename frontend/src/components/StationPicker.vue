<template>
  <div class="form-stack station-picker">
    <v-text-field v-model="query" :label="t('stations.search')" clearable />
    <p class="muted text-caption picker-hint">
      <i18n-t keypath="stations.catalogHint" scope="global">
        <template #path><code>frontend/src/stations/SOURCES.md</code></template>
      </i18n-t>
    </p>
    <div class="country-list">
      <section
        v-for="group in groups"
        :key="group.country"
        class="country"
        :class="{ open: isOpen(group.country) }"
      >
        <button
          type="button"
          class="country-head"
          :aria-expanded="isOpen(group.country)"
          @click="toggle(group.country)"
        >
          <img
            v-if="flagUrl(group.country)"
            :src="flagUrl(group.country)!"
            class="flag"
            width="20"
            height="15"
            alt=""
          />
          <span v-else class="flag code" aria-hidden="true">{{ group.country }}</span>
          <span class="grow country-name">{{ group.name }}</span>
          <span class="count" :class="{ 'has-added': addedIn(group) > 0 }">
            {{ group.presets.length }}
          </span>
          <ChevronRight :size="15" class="chevron" aria-hidden="true" />
        </button>
        <v-expand-transition>
          <div v-show="isOpen(group.country)" class="country-body">
            <button
              v-for="preset in group.presets"
              :key="preset.id"
              type="button"
              class="list-row preset"
              :disabled="added.has(preset.id) || busy === preset.id"
              :title="preset.note ? pick(preset.note, locale) : undefined"
              @click="add(preset)"
            >
              <span class="grow">
                <span class="title-line">
                  <strong>{{ pick(preset.name, locale) }}</strong>
                  <span class="network" :title="pick(NETWORKS[preset.network].name, locale)">
                    {{ NETWORKS[preset.network].short }}
                  </span>
                </span>
                <small>
                  {{
                    t('stations.presetSummary', {
                      lat: preset.lat_deg.toFixed(3),
                      lon: preset.lon_deg.toFixed(3),
                      elevation: preset.min_elev_deg,
                    })
                  }}
                </small>
              </span>
              <span class="state" :class="{ done: added.has(preset.id) }">
                <component
                  :is="added.has(preset.id) ? Check : Plus"
                  :size="13"
                  aria-hidden="true"
                />
                {{ added.has(preset.id) ? t('common.added') : t('common.add') }}
              </span>
            </button>
          </div>
        </v-expand-transition>
      </section>
      <div v-if="!groups.length" class="empty-hint">{{ t('common.noResults') }}</div>
    </div>
    <v-alert v-if="error" type="error" variant="tonal" density="compact">{{ error }}</v-alert>
  </div>
</template>

<script setup lang="ts">
import { Check, ChevronRight, Plus } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '../i18n/useLocale'
import { apiErrorText } from '../api/messages'
import { pick } from '../i18n/label'
import { usePassesStore } from '../stores/passes'
import { flagUrl } from '../stations/flags'
import {
  NETWORKS,
  presetOf,
  presetToInput,
  presetsByCountry,
  searchPresets,
  type CountryGroup,
  type StationPreset,
} from '../stations/presets'
import type { Locale } from '../i18n/locale'

const { t } = useI18n()
const passes = usePassesStore()
const query = ref('')
const busy = ref('')
const error = ref('')

const localeStore = useLocaleStore()
const locale = computed<Locale>(() => localeStore.locale)

/** Presets already in the database, so the picker cannot trip the unique-name rule. */
const added = computed(
  () =>
    new Set(
      passes.stations
        .map((station) => presetOf(station)?.id)
        .filter((id): id is string => id !== undefined),
    ),
)

const groups = computed(() =>
  presetsByCountry(searchPresets(query.value ?? '', locale.value), locale.value),
)

// Countries start folded. A search unfolds every country it matched, and folding one
// while searching is forgotten once the search is cleared.
const searching = computed(() => Boolean(query.value?.trim()))
const opened = ref(new Set<string>())
const foldedInSearch = ref(new Set<string>())
watch(searching, () => foldedInSearch.value.clear())

function isOpen(country: string) {
  return searching.value ? !foldedInSearch.value.has(country) : opened.value.has(country)
}

function toggle(country: string) {
  const set = searching.value ? foldedInSearch.value : opened.value
  if (set.has(country)) set.delete(country)
  else set.add(country)
}

function addedIn(group: CountryGroup) {
  return group.presets.filter((preset) => added.value.has(preset.id)).length
}

async function add(preset: StationPreset) {
  busy.value = preset.id
  error.value = ''
  try {
    await passes.addStation(presetToInput(preset, locale.value))
  } catch (caught) {
    error.value = apiErrorText(caught, t)
  } finally {
    busy.value = ''
  }
}
</script>

<style scoped>
.station-picker {
  padding: 12px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.picker-hint {
  margin: calc(var(--space-2) - var(--stack-gap)) 0 0;
  line-height: 1.5;
}
.country-list {
  display: grid;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
}
.country {
  border-radius: 10px;
}
.country.open {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.country-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  font-weight: 650;
  text-align: left;
  cursor: pointer;
}
.country-head:hover {
  background: rgba(var(--v-theme-primary), 0.06);
}
.country-head:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}
.country-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.flag {
  flex: none;
  width: 20px;
  height: 15px;
  border-radius: 2px;
  object-fit: cover;
  /* A white flag would otherwise vanish into a light surface. */
  box-shadow: 0 0 0 1px rgba(var(--v-theme-on-surface), 0.14);
}
.flag.code {
  display: grid;
  place-items: center;
  font-size: 8px;
  font-weight: 700;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.count {
  min-width: 22px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgb(var(--v-theme-secondary));
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.count.has-added {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.chevron {
  flex: none;
  color: rgb(var(--v-theme-secondary));
  transition: transform 0.18s ease;
}
.open .chevron {
  transform: rotate(90deg);
}
.country-body {
  display: grid;
  gap: 2px;
  margin: 0 6px 0 19px;
  padding: 0 0 6px 8px;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
.preset {
  padding: 7px 8px;
}
.title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.title-line strong {
  min-width: 0;
}
.network {
  flex: none;
  padding: 0 5px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 4px;
  color: rgb(var(--v-theme-secondary));
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  line-height: 15px;
}
.state {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  color: rgb(var(--v-theme-primary));
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.state.done {
  color: rgb(var(--v-theme-success));
}
.list-row:disabled {
  cursor: default;
  opacity: 0.6;
}
.list-row:disabled:hover {
  background: transparent;
}
</style>
