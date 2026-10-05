<template>
  <v-menu location="bottom end">
    <template #activator="{ props }">
      <v-btn v-bind="props" variant="outlined" class="locale-button" :aria-label="t('choose')">
        <Languages :size="15" class="mr-2" aria-hidden="true" />
        <span class="locale-label">{{ current }}</span>
      </v-btn>
    </template>
    <v-list density="compact" min-width="200" class="glass">
      <v-list-subheader>{{ t('label') }}</v-list-subheader>
      <v-list-item
        v-for="option in options"
        :key="option.value"
        :active="locale.preference === option.value"
        @click="locale.preference = option.value"
      >
        <v-list-item-title>{{ option.label }}</v-list-item-title>
        <v-list-item-subtitle v-if="option.description">
          {{ option.description }}
        </v-list-item-subtitle>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
import { Languages } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '../i18n/useLocale'
import type { LocalePreference } from '../i18n/locale'

const { t: translate } = useI18n()
const t = (key: string) => translate(`locale.${key}`)
const locale = useLocaleStore()

// Each language names itself, so a reader stuck in the wrong one can still find theirs.
const options = computed<{ value: LocalePreference; label: string; description?: string }[]>(() => [
  { value: 'system', label: t('system'), description: t('systemHint') },
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
])

const current = computed(() => (locale.locale === 'ko' ? 'KO' : 'EN'))
</script>

<style scoped>
.locale-button {
  height: 34px;
  padding: 0 12px;
  border-color: rgba(var(--v-theme-on-surface), 0.16);
  font-size: 12px;
  letter-spacing: 0.2px;
}
.locale-label {
  font-weight: 700;
}
@media (max-width: 760px) {
  .locale-button {
    padding: 0 9px;
  }
  .locale-label {
    display: none;
  }
  .locale-button :deep(.mr-2) {
    margin-right: 0 !important;
  }
}
</style>
