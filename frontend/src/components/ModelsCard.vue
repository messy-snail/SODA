<template>
  <DashboardCard :title="t('models.title')" eyebrow="MODELS" :icon="Box">
    <template #append>
      <v-btn
        icon
        size="x-small"
        variant="text"
        :aria-label="t('models.refresh')"
        @click="models.load()"
      >
        <RefreshCw :size="15" />
      </v-btn>
    </template>
    <div class="form-stack">
      <v-switch v-model="layers.prefs.showModels" :label="t('models.show')" />
      <ul class="notes muted">
        <li>
          <i18n-t keypath="models.notes.format" scope="global">
            <template #ext><code>.glb</code></template>
          </i18n-t>
        </li>
        <li>
          {{ t('models.notes.axes') }}
        </li>
        <li>
          <i18n-t keypath="models.notes.path" scope="global">
            <template #path><code>data/models</code></template>
            <template #defaultName><code>default.glb</code></template>
            <template #noradName><code>&lt;NORAD&gt;.glb</code></template>
          </i18n-t>
        </li>
        <li>{{ t('models.notes.follow') }}</li>
      </ul>
      <v-alert v-if="models.loadError" type="warning" variant="tonal" density="compact">
        {{ models.loadError }}
      </v-alert>

      <p class="section-label">{{ t('models.defaultSection') }}</p>
      <ModelSlot
        :name="DEFAULT_MODEL"
        :label="t('models.defaultModel')"
        :empty-text="t('models.defaultHint')"
      />

      <p class="section-label">{{ t('models.perSatelliteSection') }}</p>
      <ModelSlot
        v-for="model in perSatellite"
        :key="model.name"
        :name="model.name"
        :label="`NORAD ${model.norad_id}`"
      />
      <div v-if="!perSatellite.length" class="empty-hint">
        {{ t('models.perSatelliteHint') }}
      </div>
    </div>
  </DashboardCard>
</template>

<script setup lang="ts">
import { Box, RefreshCw } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLayersStore } from '../stores/layers'
import { useModelsStore } from '../stores/models'
import { DEFAULT_MODEL } from '../utils/models'
import DashboardCard from './DashboardCard.vue'
import ModelSlot from './ModelSlot.vue'

const { t } = useI18n()
const layers = useLayersStore()
const models = useModelsStore()
const perSatellite = computed(() => models.items.filter((model) => model.norad_id !== null))
</script>
