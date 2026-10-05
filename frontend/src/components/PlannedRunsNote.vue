<template>
  <div v-if="planned.length" class="muted text-caption" data-testid="access-run">
    <template v-if="planned.length === 1">
      {{ t('mission.target') }}
      <strong class="text-high-emphasis">{{ planned[0]!.name }}</strong>
      (NORAD {{ planned[0]!.noradId }})
      <br />
      {{ t('mission.access.window', runWindow) }}
    </template>
    <template v-else>
      {{ t('mission.access.satellites', { count: planned.length }) }}
      <span class="satellites">
        <span v-for="item in planned" :key="item.id" class="satellite">
          <i class="dot" :style="{ background: colorOf(item.colorIndex) }" aria-hidden="true" />
          <strong class="text-high-emphasis">{{ item.name }}</strong>
        </span>
      </span>
      {{ t('mission.access.windows') }}
    </template>
    <template v-if="skipped > 0">
      <br />
      {{ t('mission.access.firstOnly', { max: MAX_SATELLITES }) }}
    </template>
    <Sgp4OnlyNote :runs="runs.runs" />
  </div>
  <div v-else class="empty-hint">
    {{ t('mission.access.needRun') }}
    <br />
    <v-btn
      size="small"
      variant="tonal"
      color="primary"
      class="mt-2"
      @click="ui.openSatelliteStep(basket.focus ? 'propagate' : 'pick')"
    >
      {{ t('mission.access.toPropagate') }}
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMissionStore } from '../stores/mission'
import { useRunsStore } from '../stores/runs'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { useUiStore } from '../stores/ui'
import { orbitColorHex } from '../theme/runColors'
import { useThemePreset } from '../theme/useThemePreset'
import { MAX_SATELLITES } from '../utils/passPlan'
import { hasElements } from '../utils/satelliteRef'
import { formatUtc } from '../utils/time'
import Sgp4OnlyNote from './Sgp4OnlyNote.vue'

/**
 * Which satellites an imaging search or a coverage analysis takes: every propagated run
 * with elements, each within its own window, so a result is always somewhere the globe can
 * show that satellite. With no run yet, the way to make one.
 */
const { t } = useI18n()
const mission = useMissionStore()
const runs = useRunsStore()
const basket = useSatelliteBasketStore()
const ui = useUiStore()
const theme = useThemePreset()

const planned = computed(() => mission.planned)
/** Runs with elements beyond the ones a search takes. */
const skipped = computed(() => runs.runs.filter(hasElements).length - planned.value.length)
const colorOf = (index: number) => orbitColorHex(index, theme.preset.globe.orbitPalette)

const runWindow = computed(() => {
  const only = planned.value[0]
  return only ? { start: formatUtc(only.startMs, false), end: formatUtc(only.stopMs, false) } : {}
})
</script>

<style scoped>
.satellites {
  display: flex;
  flex-wrap: wrap;
  gap: 2px var(--space-2);
  margin: 2px 0;
}
.satellite {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
</style>
