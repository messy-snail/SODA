<template>
  <DashboardCard :title="t('app.tool.tmtc.label')" eyebrow="TC / TM" :icon="SatelliteDish" fill>
    <TmtcPanel />
  </DashboardCard>
</template>

<script setup lang="ts">
import { SatelliteDish } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import DashboardCard from './DashboardCard.vue'
import TmtcPanel from './TmtcPanel.vue'

const { t } = useI18n()
</script>
