<template>
  <section class="form-stack" data-testid="database-browser">
    <p class="muted text-caption">{{ t('settings.browse.hint') }}</p>
    <div class="browse-controls">
      <v-select
        v-model="db.table"
        :items="tableItems"
        :label="t('settings.browse.table')"
        density="compact"
        hide-details
        data-testid="browse-table"
      />
      <v-text-field
        v-model="search"
        :label="t('settings.browse.search')"
        density="compact"
        hide-details
        clearable
        spellcheck="false"
        data-testid="browse-search"
      />
    </div>
    <v-alert v-if="db.error" type="error" variant="tonal" density="compact">
      {{ apiErrorText(db.error, t) }}
    </v-alert>
    <v-data-table-server
      v-model:items-per-page="perPage"
      v-model:page="pageNumber"
      :headers="headers"
      :items="items"
      :items-length="db.page?.total ?? 0"
      :loading="db.loading"
      :items-per-page-options="[25, 50, 100, 200]"
      :no-data-text="t('settings.browse.empty')"
      item-value="_key"
      density="compact"
      show-expand
      fixed-header
      height="420"
      class="browse-table"
      data-testid="browse-rows"
      @update:options="load"
    >
      <template #expanded-row="{ columns, item }">
        <tr>
          <td :colspan="columns.length">
            <pre class="row-json">{{ JSON.stringify(item._row, null, 2) }}</pre>
          </td>
        </tr>
      </template>
    </v-data-table-server>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorText } from '../api/messages'
import { useDatabaseStore } from '../stores/database'

const { t, te } = useI18n()
const db = useDatabaseStore()
const search = ref(db.query)
const perPage = ref(50)
const pageNumber = ref(1)

const tableItems = computed(() =>
  db.tables.map((table) => ({
    value: table.name,
    title: `${te(`settings.browse.tables.${table.name}`) ? t(`settings.browse.tables.${table.name}`) : table.name} (${table.count.toLocaleString()})`,
  })),
)

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

const headers = computed(() =>
  (db.page?.columns ?? []).map((column) => ({
    title: column,
    key: column,
    sortable: false,
    value: (item: { _row: Record<string, unknown> }) => cell(item._row[column]),
  })),
)

const items = computed(() =>
  (db.page?.rows ?? []).map((row, index) => ({
    _key: `${db.page?.offset ?? 0}:${index}`,
    _row: row,
  })),
)

function load(options: { page: number; itemsPerPage: number }) {
  void db.loadPage((options.page - 1) * options.itemsPerPage, options.itemsPerPage)
}

function reload() {
  if (pageNumber.value !== 1) pageNumber.value = 1
  else load({ page: 1, itemsPerPage: perPage.value })
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    db.query = value ?? ''
    reload()
  }, 300)
})
watch(() => db.table, reload)

onMounted(() => void db.loadTables())
</script>

<style scoped>
.browse-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
}
.browse-table {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 10px;
  background: transparent;
  font-size: 12px;
}
.browse-table :deep(td) {
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.row-json {
  margin: var(--space-2) 0;
  max-height: 320px;
  overflow: auto;
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
