<template>
  <section class="form-stack" data-testid="database-backup">
    <p class="section-label">{{ t('settings.backup.title') }}</p>
    <p class="muted text-caption">{{ t('settings.backup.hint') }}</p>
    <div class="backup-actions">
      <v-btn variant="outlined" :href="databaseDownloads.userData" data-testid="backup-export">
        <Download :size="15" aria-hidden="true" class="mr-2" />
        {{ t('settings.backup.export') }}
      </v-btn>
      <v-btn
        variant="outlined"
        :loading="db.importing"
        data-testid="backup-import"
        @click="picker?.click()"
      >
        <Upload :size="15" aria-hidden="true" class="mr-2" />
        {{ t('settings.backup.import') }}
      </v-btn>
      <v-btn variant="text" :href="databaseDownloads.database" data-testid="backup-download">
        <Database :size="15" aria-hidden="true" class="mr-2" />
        {{ t('settings.backup.download') }}
      </v-btn>
      <input ref="picker" type="file" accept="application/json,.json" hidden @change="pick" />
    </div>
    <v-alert
      v-if="db.importResult"
      type="success"
      variant="tonal"
      density="compact"
      data-testid="backup-import-result"
    >
      <p>{{ t('settings.backup.added', db.importResult.added) }}</p>
      <p v-for="item in db.importResult.skipped" :key="`${item.kind}:${item.name}`" class="muted">
        {{
          t(`settings.backup.skipped.${item.reason}`, {
            kind: t(`settings.backup.kinds.${item.kind}`),
            name: item.name,
          })
        }}
      </p>
    </v-alert>
    <v-alert v-if="db.importError" type="error" variant="tonal" density="compact">
      {{ `${t('settings.backup.importFailed')}: ${apiErrorText(db.importError, t)}` }}
    </v-alert>
  </section>
</template>

<script setup lang="ts">
import { Database, Download, Upload } from 'lucide-vue-next'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { databaseDownloads } from '../api/client'
import { apiErrorText } from '../api/messages'
import { useDatabaseStore } from '../stores/database'
import { useSettingsStore } from '../stores/settings'

const { t } = useI18n()
const db = useDatabaseStore()
const settings = useSettingsStore()
const picker = ref<HTMLInputElement | null>(null)

async function pick(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await db.importFile(file)
  // Row counts above change with the import.
  if (db.importResult) await settings.loadDatabase()
}
</script>

<style scoped>
.backup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
