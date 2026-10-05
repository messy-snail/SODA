<template>
  <div class="form-stack" data-testid="mission-access">
    <template v-if="ui.imagingTab === 'targets'">
      <PlannedRunsNote />
      <PointingChips />

      <AoiTargetList />

      <v-alert v-if="mission.error" type="error" variant="tonal" density="compact">{{
        apiErrorText(mission.error, t)
      }}</v-alert>
      <p
        v-if="mission.progress && mission.progress.total > 1"
        class="muted text-caption"
        data-testid="access-progress"
      >
        {{ t('mission.access.progress', mission.progress) }}
      </p>
      <v-btn
        class="compute"
        color="primary"
        block
        :disabled="!canCompute"
        :loading="mission.loading"
        data-testid="access-compute"
        @click="compute"
      >
        <Aperture :size="15" class="mr-2" aria-hidden="true" />{{ t('mission.access.compute') }}
      </v-btn>
    </template>

    <template v-else>
      <div v-if="mission.results.length && mission.stale" class="stale" data-testid="access-stale">
        <span class="muted text-caption">{{ t('mission.access.stale') }}</span>
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          :disabled="!canCompute"
          :loading="mission.loading"
          data-testid="access-recompute"
          @click="compute"
        >
          {{ t('mission.access.recompute') }}
        </v-btn>
      </div>
      <v-alert v-if="mission.error" type="error" variant="tonal" density="compact">{{
        apiErrorText(mission.error, t)
      }}</v-alert>
      <AccessResultList v-if="mission.results.length" @pick="jump" />
      <div v-else class="empty-hint" data-testid="access-empty">
        {{ t('mission.access.resultsEmpty') }}
        <br />
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          class="mt-2"
          @click="ui.imagingTab = 'targets'"
        >
          {{ t('mission.access.toTargets') }}
        </v-btn>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Aperture } from 'lucide-vue-next'
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorText } from '../api/messages'
import { useClockStore } from '../stores/clock'
import { useMissionStore } from '../stores/mission'
import { useRunsStore } from '../stores/runs'
import { useUiStore } from '../stores/ui'
import { revealWithinRuns } from '../utils/revealWithinRuns'
import AccessResultList from './AccessResultList.vue'
import AoiTargetList from './AoiTargetList.vue'
import PlannedRunsNote from './PlannedRunsNote.vue'
import PointingChips from './PointingChips.vue'

const { t } = useI18n()
const mission = useMissionStore()
const runs = useRunsStore()
const clock = useClockStore()
const ui = useUiStore()

const canCompute = computed(
  () => !!mission.planned.length && !!mission.saved.targets.length && mission.pointingValid,
)

/** A search that answered turns the panel to what it found. */
async function compute() {
  await mission.compute()
  if (mission.results.length && !mission.stale) ui.imagingTab = 'results'
}

// Placing a target on the globe is guided from the targets tab.
watch(
  () => mission.placing,
  (placing) => {
    if (placing) ui.imagingTab = 'targets'
  },
)

/** Another satellite's window may lie outside the playback range, which only widens. */
function jump(ms: number) {
  revealWithinRuns(clock, runs.runs, ms)
}
</script>

<style scoped>
/* The search stays in reach at the foot of the panel while the targets scroll above it. */
.compute {
  position: sticky;
  bottom: 0;
  z-index: 1;
  box-shadow: 0 -8px 16px rgba(var(--v-theme-surface), 0.9);
}
.stale {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
</style>
