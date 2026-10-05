<template>
  <DashboardCard :title="t('app.tool.coverage.label')" eyebrow="COVERAGE" :icon="Grid3x3" fill>
    <template #append>
      <InfoTip :label="t('missionCoverage.about')" data-testid="coverage-about">
        <ul class="tip-list">
          <li v-for="note in NOTES" :key="note">{{ t(`missionCoverage.notes.${note}`) }}</li>
        </ul>
      </InfoTip>
      <ImagingOptionsButton />
    </template>
    <CoveragePanel />
  </DashboardCard>
</template>

<script setup lang="ts">
import { Grid3x3 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import CoveragePanel from './CoveragePanel.vue'
import DashboardCard from './DashboardCard.vue'
import ImagingOptionsButton from './ImagingOptionsButton.vue'
import InfoTip from './InfoTip.vue'

/** What the analysis assumes and leaves out, shown from the info icon. */
const NOTES = ['centre', 'grid', 'sgp4', 'overlap', 'window'] as const

/**
 * How often, and how far apart, each part of an area can be imaged. The imaging plan asks
 * when a target can be imaged; this asks where an area is well served and where it is not.
 */
const { t } = useI18n()
</script>
