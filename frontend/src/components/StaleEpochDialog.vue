<template>
  <v-dialog
    :model-value="items.length > 0"
    max-width="460"
    aria-labelledby="stale-epoch-title"
    @update:model-value="(open: boolean) => !open && emit('cancel')"
  >
    <v-card class="stale-dialog glass" elevation="0" rounded="lg" border data-testid="stale-epoch">
      <v-card-title id="stale-epoch-title" class="title">
        <TriangleAlert :size="18" aria-hidden="true" />{{ t('propagate.trust.dialogTitle') }}
      </v-card-title>
      <v-card-text class="form-stack">
        <p>{{ t('propagate.trust.dialogBody') }}</p>
        <ul class="rows">
          <li v-for="item in items" :key="item.key" class="list-row">
            <strong>{{ item.name }}</strong>
            <small class="muted">
              {{ t('propagate.trust.dialogRow', item.text) }}
            </small>
            <v-chip
              size="x-small"
              variant="tonal"
              :color="theme.preset.globe.trust[item.level]"
              class="level"
            >
              {{ t(`propagate.trust.levels.${item.level}`) }}
            </v-chip>
          </li>
        </ul>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('cancel')">{{ t('common.cancel') }}</v-btn>
        <v-btn color="warning" data-testid="stale-epoch-confirm" @click="emit('confirm')">
          {{ t('propagate.trust.dialogConfirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { TriangleAlert } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TrustLevel } from '../orbit/epochTrust'
import { useThemePreset } from '../theme/useThemePreset'
import { formatUtc } from '../utils/time'

export interface StaleTarget {
  key: string
  name: string
  epochMs: number
  /** Furthest distance of the window from the epoch, in days. */
  days: number
  level: Extract<TrustLevel, 'poor'>
}

const props = defineProps<{ targets: readonly StaleTarget[] }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const { t } = useI18n()
const theme = useThemePreset()

const items = computed(() =>
  props.targets.map((target) => ({
    ...target,
    text: { epoch: formatUtc(target.epochMs, false), days: target.days.toFixed(1) },
  })),
)
</script>

<style scoped>
.stale-dialog {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}
.title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.title svg {
  color: rgb(var(--v-theme-warning));
}
.rows {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  list-style: none;
}
.rows li {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  column-gap: var(--space-2);
}
.rows small {
  grid-column: 1;
}
.level {
  grid-row: 1 / span 2;
  grid-column: 2;
}
</style>
