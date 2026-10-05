<template>
  <header class="soda-header glass glass--frame">
    <div class="soda-brand">
      <img :src="wordmark" alt="SODA" width="812" height="218" />
    </div>
    <v-spacer />
    <v-menu location="bottom end" :close-on-content-click="false">
      <template #activator="{ props }">
        <button v-bind="props" type="button" class="status-chip" :data-level="level">
          <span class="dot" aria-hidden="true" />
          <span>{{ summary }}</span>
        </button>
      </template>
      <v-card class="status-card glass" min-width="320">
        <v-card-text class="form-stack">
          <p class="eyebrow">{{ t('status.title') }}</p>
          <p v-if="catalog.statusError" class="text-error">{{ catalog.statusError }}</p>
          <template v-else-if="catalog.status">
            <div class="stat-grid">
              <div class="stat">
                <span>{{ t('status.cached') }}</span
                ><strong>{{ catalog.status.objects.toLocaleString() }}</strong>
              </div>
              <div class="stat">
                <span>Space-Track</span>
                <strong>{{
                  t(
                    catalog.status.spacetrack_enabled
                      ? 'status.spacetrack.on'
                      : 'status.spacetrack.off',
                  )
                }}</strong>
              </div>
            </div>
            <div v-for="fetch in groupFetches" :key="fetch.key" class="fetch-row">
              <strong>{{ fetch.key.replace('group:', '') }}</strong>
              <small class="muted">
                {{ statusText(fetch.last_status) }} · {{ t('status.lastOk') }}
                {{ fetch.last_ok_at ? formatAgo(Date.parse(fetch.last_ok_at)) : t('common.none') }}
              </small>
              <small v-if="fetch.next_allowed_at" class="muted">
                {{
                  t('status.nextAllowed', {
                    time: formatUtc(Date.parse(fetch.next_allowed_at), false),
                  })
                }}
              </small>
              <small v-if="fetch.last_status === 'error'" class="text-error">{{
                fetch.detail
              }}</small>
            </div>
            <p v-if="!groupFetches.length" class="muted">{{ t('status.empty') }}</p>
          </template>
          <v-btn variant="tonal" color="primary" :loading="refreshing" @click="refresh">
            <RefreshCw :size="15" class="mr-2" aria-hidden="true" />{{ t('status.refresh') }}
          </v-btn>
          <small class="muted">{{ t('status.policy') }}</small>
          <small v-if="refreshResult" class="muted">{{
            t('status.result', { text: refreshResult })
          }}</small>
        </v-card-text>
      </v-card>
    </v-menu>
    <HelpMenu />
    <LocaleMenu />
    <v-btn
      variant="outlined"
      class="settings-button"
      :aria-label="t('settings.open')"
      :title="t('settings.open')"
      data-testid="settings-open"
      @click="settingsStore.open = true"
    >
      <SettingsIcon :size="16" aria-hidden="true" />
    </v-btn>
    <SettingsDialog />
  </header>
</template>

<script setup lang="ts">
import { RefreshCw, Settings as SettingsIcon } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorText } from '../api/messages'
import { useCatalogStore } from '../stores/catalog'
import { useSettingsStore } from '../stores/settings'
import { useThemePreset } from '../theme/useThemePreset'
import { formatUtc } from '../utils/time'
import { useTimeText } from '../utils/useTimeText'
import HelpMenu from './HelpMenu.vue'
import LocaleMenu from './LocaleMenu.vue'
import SettingsDialog from './SettingsDialog.vue'

const { t } = useI18n()
const { formatAgo } = useTimeText()
const catalog = useCatalogStore()
const settingsStore = useSettingsStore()
const theme = useThemePreset()
const wordmark = computed(
  () => `${import.meta.env.BASE_URL}brand/wordmark-${theme.preset.dark ? 'dark' : 'light'}.svg`,
)
const refreshing = ref(false)
const refreshResult = ref('')
const STALE_MS = 3 * 3_600_000

const groupFetches = computed(
  () => catalog.status?.fetches.filter((fetch) => fetch.key.startsWith('group:')) ?? [],
)

const level = computed(() => {
  const fetch = catalog.groupFetch
  if (catalog.statusError || fetch?.last_status === 'error') return 'error'
  if (!fetch?.last_ok_at || Date.now() - Date.parse(fetch.last_ok_at) > STALE_MS) return 'warning'
  return 'success'
})

const summary = computed(() => {
  if (catalog.statusError) return t('status.offline')
  const fetch = catalog.groupFetch
  const count = catalog.status?.objects.toLocaleString() ?? '–'
  if (!fetch?.last_ok_at) return t('status.chip.waiting', { count })
  return t('status.chip.ok', { ago: formatAgo(Date.parse(fetch.last_ok_at)), count })
})

const FETCH_STATES = ['ok', 'not_modified', 'not_found', 'error', 'skipped']

function statusText(status: string) {
  return FETCH_STATES.includes(status) ? t(`status.fetch.${status}`) : status
}

async function refresh() {
  refreshing.value = true
  try {
    const result = await catalog.refreshGroup('active')
    refreshResult.value = statusText(result)
  } catch (error) {
    refreshResult.value = apiErrorText(error, t)
  } finally {
    refreshing.value = false
  }
}
</script>

<style scoped>
.settings-button {
  min-width: 34px !important;
  height: 34px !important;
  margin-right: 16px;
  padding: 0 !important;
  border-color: rgba(var(--v-theme-on-surface), 0.15);
}
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-right: 10px;
  padding: 6px 11px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.13);
  border-radius: 8px;
  background: rgba(var(--v-theme-surface), var(--lg-well));
  color: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(var(--v-theme-success));
}
[data-level='warning'] .dot {
  background: rgb(var(--v-theme-warning));
}
[data-level='error'] .dot {
  background: rgb(var(--v-theme-error));
}
.fetch-row {
  display: grid;
  gap: 2px;
}
@media (max-width: 760px) {
  .status-chip span:last-child {
    display: none;
  }
}
</style>
