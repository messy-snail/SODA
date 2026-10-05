<template>
  <section class="form-stack">
    <p class="section-label">{{ t('settings.appearance.title') }}</p>
    <v-switch
      v-model="appearance.glass"
      :label="t('settings.appearance.glass')"
      color="primary"
      density="compact"
      hide-details
      data-testid="glass-switch"
    />
    <p class="muted text-caption hint">{{ t('settings.appearance.glassHint') }}</p>
    <v-slider
      v-model="appearance.intensity"
      :label="t('settings.appearance.clarity')"
      :min="0"
      :max="1"
      :step="0.05"
      :disabled="!appearance.glass"
      color="primary"
      density="compact"
      hide-details
      thumb-label
    >
      <template #thumb-label="{ modelValue }">{{ Math.round(modelValue * 100) }}%</template>
    </v-slider>
    <p class="muted text-caption hint">{{ t('settings.appearance.clarityHint') }}</p>
    <div>
      <v-btn size="small" variant="text" @click="appearance.reset()">
        {{ t('settings.appearance.reset') }}
      </v-btn>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAppearanceStore } from '../stores/appearance'

const { t } = useI18n()
const appearance = useAppearanceStore()
</script>
