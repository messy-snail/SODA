<template>
  <div class="facts" :data-testid="`facts-${key}`">
    <v-progress-linear v-if="!detail && !error" indeterminate color="primary" height="2" />
    <p v-if="error" class="text-error">{{ error }}</p>
    <template v-if="detail">
      <p class="line">
        {{ t('catalog.period') }} <strong>{{ detail.orbit.period_min.toFixed(1) }}</strong>
        {{ t('catalog.minutes') }} · {{ t('catalog.inclination') }}
        <strong>{{ detail.orbit.inclination_deg.toFixed(2) }}°</strong>
      </p>
      <p class="line">
        {{ t('catalog.altitude') }}
        <strong
          >{{ detail.orbit.perigee_alt_km.toFixed(0) }} /
          {{ detail.orbit.apogee_alt_km.toFixed(0) }}</strong
        >
        km
      </p>
      <p class="line muted">
        Epoch {{ formatUtc(Date.parse(detail.epoch)) }} UTC ·
        {{ formatAgo(Date.parse(detail.epoch)) }} ·
        {{ sourceLabel }}
      </p>
      <div v-if="groups.length" class="groups">
        <v-chip v-for="group in groups" :key="group" size="x-small" variant="outlined">
          {{ pick(groupLabel(group), locale.locale) }}
        </v-chip>
      </div>
      <div class="actions">
        <v-btn
          size="x-small"
          variant="text"
          :aria-pressed="favorite"
          data-testid="satellite-favorite"
          @click="picks.toggleFavorite(satRef, detail.name)"
        >
          <Star :size="13" class="mr-1" :fill="favorite ? 'currentColor' : 'none'" />
          {{ t(favorite ? 'catalog.unfavorite' : 'catalog.favorite') }}
        </v-btn>
        <v-btn v-if="detail.tle" size="x-small" variant="text" @click="copyTle">
          <component :is="copied ? Check : Copy" :size="13" class="mr-1" />
          {{ copied ? t('catalog.copied') : t('catalog.copyTle') }}
        </v-btn>
        <v-btn
          size="x-small"
          variant="text"
          data-testid="satellite-logo-link"
          @click="ui.openTool('view', 'markers')"
        >
          <ImageIcon :size="13" class="mr-1" />{{ t('catalog.logoSettings') }}
        </v-btn>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Check, Copy, Image as ImageIcon, Star } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { groupLabel } from '../catalog/groups'
import { pick } from '../i18n/label'
import { useLocaleStore } from '../i18n/useLocale'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { useSatellitePicksStore } from '../stores/satellitePicks'
import { useUiStore } from '../stores/ui'
import { customKind, satKey, type SatelliteRef } from '../utils/satelliteRef'
import { formatUtc } from '../utils/time'
import { useTimeText } from '../utils/useTimeText'

const props = defineProps<{ satRef: SatelliteRef }>()
const { t } = useI18n()
const { formatAgo } = useTimeText()
const locale = useLocaleStore()
const basket = useSatelliteBasketStore()
const picks = useSatellitePicksStore()
const ui = useUiStore()
const copied = ref(false)

const key = computed(() => satKey(props.satRef))
const detail = computed(() => basket.detailOf(props.satRef))
const error = computed(() => basket.errorOf(props.satRef))
const favorite = computed(() => picks.isFavorite(props.satRef))
/** Where the orbit came from: the provider, or what kind of thing the user saved. */
const sourceLabel = computed(() => {
  const kind = customKind(props.satRef)
  if (kind === 'state') return t('catalog.userState')
  if (kind === 'ephemeris') return t('catalog.userEphemeris')
  return kind ? t('catalog.userElements') : (detail.value?.source ?? '')
})
/**
 * CelesTrak groups this satellite was refreshed in. `active` is the default refresh group, so
 * nearly every satellite has it and it tells the reader nothing.
 */
const groups = computed(() => detail.value?.groups.filter((g) => g !== 'active') ?? [])

onMounted(() => void basket.loadDetail(props.satRef))

async function copyTle() {
  if (!detail.value?.tle) return
  await navigator.clipboard.writeText(detail.value.tle.join('\n'))
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<style scoped>
.facts {
  display: grid;
  gap: 3px;
  padding: 2px 10px 8px 36px;
  font-size: 12px;
}
.line {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.line strong {
  font-weight: 650;
}
.groups {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin: 2px 0 0 -8px;
}
</style>
