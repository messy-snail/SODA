<template>
  <section class="form-stack" data-testid="database-settings">
    <p class="section-label">{{ t('settings.database.current') }}</p>
    <v-alert v-if="loadError" type="error" variant="tonal" density="compact">
      {{ loadError }}
    </v-alert>
    <template v-if="db">
      <div class="stat-grid">
        <div class="stat">
          <span>{{ t('settings.database.backend') }}</span
          ><strong>{{ db.backend }}</strong>
        </div>
        <div class="stat">
          <span>{{ t('settings.database.size') }}</span
          ><strong>{{ formatBytes(db.size_bytes) }}</strong>
        </div>
        <div v-for="key in COUNT_KEYS" :key="key" class="stat">
          <span>{{ t(`settings.database.${key}`) }}</span
          ><strong>{{ db.counts[key].toLocaleString() }}</strong>
        </div>
      </div>
      <dl class="db-facts">
        <dt>{{ t('settings.database.path') }}</dt>
        <dd class="mono" data-testid="database-path">{{ db.path }}</dd>
        <dt>{{ t('settings.database.source') }}</dt>
        <dd>{{ t(`settings.database.sources.${db.source}`) }}</dd>
      </dl>
      <v-alert
        v-if="db.restart_required"
        type="warning"
        variant="tonal"
        density="compact"
        data-testid="database-restart"
      >
        {{ t('settings.database.restart', { url: db.next_url }) }}
      </v-alert>

      <p class="section-label">{{ t('settings.database.change') }}</p>
      <v-alert v-if="!db.editable" type="info" variant="tonal" density="compact">
        {{ t('settings.database.envLocked') }}
      </v-alert>
      <v-text-field
        v-model="url"
        :label="t('settings.database.url')"
        :placeholder="db.default_url"
        :hint="t('settings.database.urlHint')"
        :disabled="!db.editable"
        persistent-hint
        spellcheck="false"
        data-testid="database-url"
        @update:model-value="settings.probe = null"
      />
      <div class="db-actions">
        <v-btn
          variant="outlined"
          :disabled="!db.editable"
          :loading="settings.busy && action === 'test'"
          @click="test"
        >
          {{ t('settings.database.test') }}
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!db.editable || (settings.probe !== null && !settings.probe.ok)"
          :loading="settings.busy && action === 'save'"
          @click="save"
        >
          {{ t('settings.database.save') }}
        </v-btn>
      </div>
      <v-alert
        v-if="settings.probe"
        :type="settings.probe.ok ? 'success' : 'error'"
        variant="tonal"
        density="compact"
        data-testid="database-probe"
      >
        {{ probeText }}
      </v-alert>
      <v-alert v-if="actionError" type="error" variant="tonal" density="compact">
        {{ actionError }}
      </v-alert>
      <p class="muted text-caption">
        {{ t('settings.database.savedTo', { file: db.settings_file }) }}
      </p>
      <v-divider class="my-2" />
      <DatabaseBackup />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorText } from '../api/messages'
import type { DatabaseStatus } from '../api/types'
import { useSettingsStore } from '../stores/settings'
import { formatBytes } from '../utils/namedFiles'
import DatabaseBackup from './DatabaseBackup.vue'

const COUNT_KEYS = [
  'objects',
  'history',
  'stations',
  'sensor_presets',
  'custom_elements',
  'fetches',
] as const satisfies readonly (keyof DatabaseStatus['counts'])[]

const { t } = useI18n()
const settings = useSettingsStore()
const db = computed(() => settings.database)
const url = ref('')
const action = ref<'load' | 'test' | 'save'>('load')

const loadError = computed(() =>
  action.value === 'load' && settings.error
    ? `${t('settings.database.loadFailed')}: ${apiErrorText(settings.error, t)}`
    : '',
)
const actionError = computed(() =>
  action.value !== 'load' && settings.error ? apiErrorText(settings.error, t) : '',
)

const probeText = computed(() => {
  const probe = settings.probe
  if (!probe) return ''
  if (!probe.ok) return t('settings.database.probe.failed', { detail: probe.detail })
  const state = probe.initialized ? 'existing' : probe.exists ? 'empty' : 'create'
  return `${t('settings.database.probe.ready', { path: probe.path ?? probe.url })} ${t(
    `settings.database.probe.${state}`,
  )}`
})

async function test() {
  action.value = 'test'
  await settings.testDatabase(url.value)
}

async function save() {
  action.value = 'save'
  if (await settings.saveDatabase(url.value)) url.value = ''
}

onMounted(async () => {
  action.value = 'load'
  await settings.loadDatabase()
  // A URL already saved for the next start is what the field should offer to change.
  if (settings.database?.restart_required) url.value = settings.database.next_url
})
</script>

<style scoped>
.db-facts {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 12px;
  margin: 0;
  font-size: 12px;
}
.db-facts dt {
  color: rgb(var(--v-theme-secondary));
}
.db-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.db-actions {
  display: flex;
  gap: 8px;
}
</style>
