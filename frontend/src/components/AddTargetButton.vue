<template>
  <v-btn
    icon
    size="x-small"
    variant="text"
    :color="existing ? 'primary' : undefined"
    :disabled="!existing && full"
    :aria-pressed="!!existing"
    :aria-label="label"
    :title="label"
    :data-testid="testId"
    @click="act"
  >
    <Aperture :size="14" />
  </v-btn>
</template>

<script setup lang="ts">
import { Aperture } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { findTarget, targetName, type TargetCandidate } from '../mission/fromPlaces'
import { MAX_TARGETS } from '../mission/targets'
import { useMissionStore } from '../stores/mission'
import { useUiStore } from '../stores/ui'

/**
 * Copies a place into the imaging targets. Once a target sits at that place the button
 * stays lit and opens it in the imaging tool instead, so a place is never added twice.
 */
const props = defineProps<{ candidate: TargetCandidate; testId: string }>()

const { t } = useI18n()
const mission = useMissionStore()
const ui = useUiStore()

const existing = computed(() => findTarget(mission.saved.targets, props.candidate))
const full = computed(() => mission.saved.targets.length >= MAX_TARGETS)
const label = computed(() => {
  if (existing.value) return t('places.target.exists')
  if (full.value) return t('places.target.full', { max: MAX_TARGETS })
  return t(props.candidate.kind === 'box' ? 'places.target.addArea' : 'places.target.add')
})

function act() {
  if (existing.value) {
    mission.focusedTargetId = existing.value.id
    ui.openImagingTab('targets')
    return
  }
  const { candidate } = props
  const name = targetName(candidate.name) || undefined
  if (candidate.kind === 'point') mission.addPoint(candidate.lat_deg, candidate.lon_deg, name)
  else {
    const { west_deg, south_deg, east_deg, north_deg } = candidate
    mission.addBox({ west_deg, south_deg, east_deg, north_deg }, name)
  }
}
</script>
