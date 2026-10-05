<template>
  <DashboardCard
    section-id="places.search"
    :title="t('places.search.title')"
    eyebrow="PLACES"
    :icon="MapPin"
  >
    <div class="form-stack">
      <v-text-field
        v-model="query"
        :label="t('places.search.query')"
        :placeholder="t('places.search.placeholder')"
        clearable
        autofocus
        data-testid="place-search"
        @keydown.enter="goFirst"
      >
        <template #prepend-inner><Search :size="16" aria-hidden="true" /></template>
      </v-text-field>
      <v-progress-linear v-if="loading" indeterminate color="primary" height="2" />
      <p v-if="loadError" class="text-error text-caption">{{ t('places.search.loadFailed') }}</p>

      <div v-if="coordinate || hits.length" class="results">
        <div v-if="coordinate" class="list-row" data-testid="place-coordinate">
          <Crosshair :size="18" class="row-icon" aria-hidden="true" />
          <button type="button" class="grow row-main" @click="flyToCoordinate">
            <strong>{{ t('places.search.coordinate') }}</strong>
            <small>{{ formatLatLon(coordinate.lat_deg, coordinate.lon_deg) }}</small>
          </button>
          <v-btn
            icon
            size="x-small"
            variant="text"
            :aria-label="t('places.search.addPin')"
            :title="t('places.search.addPin')"
            data-testid="place-pin"
            @click="pinCoordinate"
          >
            <MapPinPlus :size="14" />
          </v-btn>
          <AddTargetButton
            :candidate="{ kind: 'point', name: '', ...coordinate }"
            test-id="place-target"
          />
        </div>
        <div v-for="(hit, index) in hits" :key="index" class="list-row" data-testid="place-hit">
          <img v-if="flagOf(hit)" :src="flagOf(hit)!" alt="" class="flag" width="20" height="15" />
          <Building2 v-else :size="18" class="row-icon" aria-hidden="true" />
          <button type="button" class="grow row-main" @click="fly(hit)">
            <strong>{{ nameOf(hit) }}</strong>
            <small>{{ detailOf(hit) }}</small>
          </button>
          <v-btn
            icon
            size="x-small"
            variant="text"
            :aria-label="t('places.search.addPin')"
            :title="t('places.search.addPin')"
            data-testid="place-pin"
            @click="pin(hit)"
          >
            <MapPinPlus :size="14" />
          </v-btn>
          <AddTargetButton :candidate="candidateOf(hit)" test-id="place-target" />
        </div>
      </div>
      <div v-else-if="query && !loading" class="empty-hint">
        {{ t('places.search.noResults') }}
      </div>
      <p class="muted text-caption">{{ t('places.search.source') }}</p>
    </div>
  </DashboardCard>
</template>

<script setup lang="ts">
import { Building2, Crosshair, MapPin, MapPinPlus, Search } from 'lucide-vue-next'
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { pick } from '../i18n/label'
import { useLocaleStore } from '../i18n/useLocale'
import { boxFromBbox, type TargetCandidate } from '../mission/fromPlaces'
import { CITY_HEIGHT_M, pointForBbox } from '../places/camera'
import { countryFlagUrl } from '../places/flags'
import { loadCities, loadCountries, type City, type Country } from '../places/geoData'
import { formatLatLon, parseLatLon, searchPlaces, type PlaceHit } from '../places/search'
import { usePlacesStore } from '../stores/places'
import AddTargetButton from './AddTargetButton.vue'
import DashboardCard from './DashboardCard.vue'

const { t } = useI18n()
const locale = useLocaleStore()
const places = usePlacesStore()
const query = ref('')
const countries = shallowRef<Country[]>([])
const cities = shallowRef<City[]>([])
const loading = ref(false)
const loadError = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    ;[countries.value, cities.value] = await Promise.all([loadCountries(), loadCities()])
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
})

const queryText = computed(() => query.value?.trim() ?? '')
const coordinate = computed(() => parseLatLon(queryText.value))
const hits = computed(() =>
  coordinate.value
    ? []
    : searchPlaces(queryText.value, countries.value, cities.value, locale.locale),
)

const countryName = computed(() => {
  const names = new Map(countries.value.map((c) => [c.iso2, pick(c.name, locale.locale)]))
  return (iso2: string) => names.get(iso2) ?? iso2
})

function nameOf(hit: PlaceHit): string {
  return pick(hit.kind === 'country' ? hit.country.name : hit.city.name, locale.locale)
}

function detailOf(hit: PlaceHit): string {
  if (hit.kind === 'country') return `${t('places.search.country')} · ${hit.country.iso2}`
  const { city } = hit
  const kind = city.capital ? t('places.search.capital') : t('places.search.city')
  return `${kind} · ${countryName.value(city.iso2)} · ${formatLatLon(city.lat, city.lon)}`
}

function flagOf(hit: PlaceHit): string | null {
  return countryFlagUrl(hit.kind === 'country' ? hit.country.iso2 : hit.city.iso2)
}

function fly(hit: PlaceHit) {
  if (hit.kind === 'country') places.flyToBbox(hit.country.bbox)
  else places.flyToPoint({ lon_deg: hit.city.lon, lat_deg: hit.city.lat, height_m: CITY_HEIGHT_M })
}

function flyToCoordinate() {
  const point = coordinate.value
  if (point) places.flyToPoint({ ...point, height_m: CITY_HEIGHT_M })
}

function goFirst() {
  if (coordinate.value) flyToCoordinate()
  else if (hits.value[0]) fly(hits.value[0])
}

/**
 * Show a result as a pin candidate: fly there and ring the spot (a country at its label
 * point), and fill the pin form so "add pin" confirms it.
 */
function pin(hit: PlaceHit) {
  const point =
    hit.kind === 'country'
      ? pointForBbox(hit.country.bbox, hit.country.label)
      : { lon_deg: hit.city.lon, lat_deg: hit.city.lat }
  const icon = hit.kind === 'city' ? 'building' : 'flag'
  fly(hit)
  places.setDraft(point.lon_deg, point.lat_deg, { name: nameOf(hit), icon })
}

/**
 * A result as an imaging target: a city is a point, a country the box of its extent (the
 * mainland only, as the camera frames it).
 */
function candidateOf(hit: PlaceHit): TargetCandidate {
  const name = nameOf(hit)
  return hit.kind === 'country'
    ? { kind: 'box', name, ...boxFromBbox(hit.country.bbox) }
    : { kind: 'point', name, lat_deg: hit.city.lat, lon_deg: hit.city.lon }
}

/** Typed coordinates carry no name, so the pin form keeps the suggested one. */
function pinCoordinate() {
  const point = coordinate.value
  if (!point) return
  flyToCoordinate()
  places.setDraft(point.lon_deg, point.lat_deg, { name: '', icon: 'pin' })
}
</script>

<style scoped>
.results {
  display: grid;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
}
.row-main {
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.row-icon {
  flex-shrink: 0;
  color: rgb(var(--v-theme-secondary));
}
.flag {
  flex-shrink: 0;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(var(--v-theme-on-surface), 0.12);
}
</style>
