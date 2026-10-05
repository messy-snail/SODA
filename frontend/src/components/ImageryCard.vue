<template>
  <DashboardCard :title="t('imagery.title')" eyebrow="IMAGERY" :icon="Images">
    <template #append>
      <v-btn
        icon
        size="x-small"
        variant="text"
        :aria-label="t('imagery.reload')"
        :title="t('imagery.reload')"
        @click="imagery.load()"
      >
        <RefreshCw :size="15" />
      </v-btn>
    </template>
    <div
      class="form-stack drop-zone"
      :class="{ 'drop-zone--over': dragging }"
      data-testid="imagery-drop"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="dropped"
    >
      <v-switch
        v-model="layers.prefs.showUserImagery"
        :label="t('imagery.auto')"
        :title="t('imagery.hint')"
        data-testid="imagery-auto"
      />
      <v-alert v-if="imagery.loadError" type="warning" variant="tonal" density="compact">
        {{ imagery.loadError }}
      </v-alert>

      <CollapsibleSection
        id="imagery.list"
        :title="t('imagery.section.list')"
        :summary="t('imagery.section.count', { count: imagery.items.length })"
      >
        <template v-if="imagery.items.length">
          <ImageryFilterBar />
          <div v-if="imagery.shown.length" class="imagery-list" data-testid="imagery-list">
            <ImageryRow v-for="item in imagery.shown" :key="item.id" :item="item" />
          </div>
          <div v-else class="no-match">
            <p class="empty-hint">{{ t('imagery.filter.none') }}</p>
            <v-btn size="small" variant="text" data-testid="imagery-filter-clear" @click="clear">
              {{ t('imagery.filter.clear') }}
            </v-btn>
          </div>
        </template>
        <p v-else class="empty-hint">{{ t('imagery.empty') }}</p>
        <div
          v-if="imagery.samples?.enabled && !imagery.samples.present"
          class="note-block"
          data-testid="imagery-samples-missing"
        >
          <p class="field-note">{{ t('imagery.samples.missing') }}</p>
          <code class="path">git submodule update --init samples</code>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="imagery.add"
        :title="t('imagery.section.add')"
        :summary="waiting ? t('imagery.section.waiting', { count: waiting }) : ''"
      >
        <!--
          Two ways in, as tabs on one panel: the strip sits on the box whose contents it
          switches, so it does not read as one more option of the form below it.
        -->
        <div class="add-panel">
          <div class="add-tabs">
            <v-tabs
              v-model="addTab"
              density="compact"
              grow
              color="primary"
              :aria-label="t('imagery.addTab.label')"
            >
              <v-tab value="file" data-testid="imagery-add-tab-file">
                <Upload :size="14" class="mr-1" aria-hidden="true" />{{ t('imagery.addTab.file') }}
              </v-tab>
              <v-tab value="catalog" data-testid="imagery-add-tab-catalog">
                <Search :size="14" class="mr-1" aria-hidden="true" />{{
                  t('imagery.addTab.catalog')
                }}
              </v-tab>
            </v-tabs>
            <InfoTip :label="t('imagery.addTab.label')">
              {{ t(addTab === 'file' ? 'imagery.dropHint' : 'imagery.catalog.hint') }}
            </InfoTip>
          </div>
          <div class="form-stack add-body">
            <template v-if="addTab === 'file'">
              <ImageryBatchForm v-if="batch" :files="batch" @close="closeForm" />
              <ImageryImportForm
                v-else
                :key="formKey"
                :initial-file="single"
                @close="closeForm"
                @batch="openBatch"
              />
              <div v-if="imagery.inbox?.enabled" class="inbox" data-testid="imagery-inbox">
                <div class="inbox-head">
                  <span class="section-label">{{ t('imagery.inbox.title') }}</span>
                  <InfoTip :label="t('imagery.inbox.title')">
                    {{ t('imagery.inbox.hint') }}
                  </InfoTip>
                </div>
                <code class="path">{{ imagery.inbox.path }}</code>
                <ul v-if="imagery.inbox.waiting.length" class="inbox-waiting">
                  <li v-for="entry in imagery.inbox.waiting" :key="entry.file">
                    {{ entry.file }} · {{ t(`imagery.inbox.reason.${entry.reason}`) }}
                  </li>
                </ul>
              </div>
            </template>
            <ImageryCatalogSearch v-else />
          </div>
        </div>
      </CollapsibleSection>
    </div>
  </DashboardCard>
</template>

<script setup lang="ts">
import { Images, RefreshCw, Search, Upload } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useImageryStore } from '../stores/imagery'
import { useLayersStore } from '../stores/layers'
import { useUiStore } from '../stores/ui'
import { NO_IMAGERY_FILTER } from '../utils/imagery'
import CollapsibleSection from './CollapsibleSection.vue'
import DashboardCard from './DashboardCard.vue'
import ImageryBatchForm from './ImageryBatchForm.vue'
import ImageryCatalogSearch from './ImageryCatalogSearch.vue'
import ImageryFilterBar from './ImageryFilterBar.vue'
import ImageryImportForm from './ImageryImportForm.vue'
import ImageryRow from './ImageryRow.vue'
import InfoTip from './InfoTip.vue'

/**
 * The user's own imagery and the samples. The list is what the tab opens on. Adding waits
 * folded below it, with a file of one's own and the public catalogues as its two tabs, so the
 * tab stays one screen long.
 * Samples come with the `samples` git submodule and are only listed here.
 */
const { t } = useI18n()
const imagery = useImageryStore()
const layers = useLayersStore()
const ui = useUiStore()

const ADD_SECTION = 'imagery.add'
/** Files sitting in the watched folder, shown beside the folded heading. */
const waiting = computed(() => imagery.inbox?.waiting.length ?? 0)
/** Which way of adding is shown; not remembered. */
const addTab = ref<'file' | 'catalog'>('file')
/** Files of a multi-file import; the batch form replaces the single-file one while set. */
const batch = ref<File[] | null>(null)
/** A single dropped file, handed to the form so it opens already filled in. */
const single = ref<File>()
const formKey = ref(0)
const dragging = ref(false)

function clear() {
  imagery.filter = { ...NO_IMAGERY_FILTER }
}

function openBatch(files: File[]) {
  batch.value = files
}

/** Done or dismissed: fold the section away and leave a clean form for next time. */
function closeForm() {
  batch.value = null
  single.value = undefined
  formKey.value += 1
  if (!ui.isCollapsed(ADD_SECTION)) ui.toggleCollapsed(ADD_SECTION)
}

function dropped(event: DragEvent) {
  dragging.value = false
  const files = [...(event.dataTransfer?.files ?? [])]
  if (!files.length) return
  ui.expand(ADD_SECTION)
  addTab.value = 'file'
  if (files.length > 1) openBatch(files)
  else {
    batch.value = null
    single.value = files[0]
    // A new key rebuilds the form, so a second drop replaces the first file.
    formKey.value += 1
  }
}
</script>

<style scoped>
/* The whole card takes a drop; the outline says so while a file hovers over it. */
.drop-zone {
  border-radius: 10px;
  outline: 1px dashed transparent;
  outline-offset: 4px;
}
.drop-zone--over {
  outline-color: rgb(var(--v-theme-primary));
}
.note-block {
  display: grid;
  gap: var(--space-1);
}
/* One box: the tab strip is its top edge, and what a tab shows fills the rest. */
.add-panel {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
}
.add-tabs {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-right: var(--space-3);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
.add-tabs :deep(.v-tabs) {
  flex: 1;
  min-width: 0;
}
/* Two tabs share the strip; Vuetify's 90 px minimum would crowd the info icon. */
.add-tabs :deep(.v-tab) {
  min-width: 0;
  padding-inline: var(--space-2);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
}
.add-body {
  padding: var(--space-3);
}
.inbox {
  display: grid;
  gap: var(--space-1);
  padding-top: var(--space-2);
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.inbox-head {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.path {
  overflow-wrap: anywhere;
  font-size: 11px;
  color: rgb(var(--v-theme-secondary));
}
.inbox-waiting {
  margin: 0;
  padding-left: 16px;
  font-size: 11.5px;
  color: rgb(var(--v-theme-secondary));
}
.imagery-list {
  display: grid;
  gap: var(--space-1);
}
.no-match {
  display: grid;
  justify-items: start;
  gap: var(--space-1);
}
</style>
