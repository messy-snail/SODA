<template>
  <DashboardCard :title="t('passes.title')" eyebrow="GROUND STATION" :icon="RadioTower">
    <div class="form-stack">
      <PassSatelliteList />

      <div>
        <div class="station-head">
          <p class="section-label">
            {{ t('passes.stations', { count: passes.selectedIds.length, max: MAX_STATIONS }) }}
          </p>
          <v-btn
            size="small"
            variant="text"
            data-testid="station-add"
            :aria-expanded="addMode !== null"
            :aria-label="addMode ? t('passes.collapseAdd') : t('passes.addStation')"
            @click="toggleAdd"
          >
            <component
              :is="addMode ? ChevronUp : Plus"
              :size="14"
              class="mr-1"
              aria-hidden="true"
            />
            {{ t('passes.addStation') }}
          </v-btn>
        </div>
        <div class="station-list">
          <div
            v-for="station in passes.stations"
            :key="station.id"
            class="list-row"
            :class="{ selected: passes.isSelected(station.id) }"
          >
            <button
              type="button"
              class="grow pick"
              :aria-pressed="passes.isSelected(station.id)"
              :disabled="passes.full && !passes.isSelected(station.id)"
              @click="passes.toggleStation(station.id)"
            >
              <span class="name">
                <i class="swatch" :style="{ background: colorOf(station.id) }" aria-hidden="true" />
                <strong :data-hand-entered="presetOf(station) ? undefined : ''">{{
                  label(station)
                }}</strong>
              </span>
              <small>
                {{ station.lat_deg.toFixed(3) }}°, {{ station.lon_deg.toFixed(3) }}° ·
                {{ station.min_elev_deg }}°{{
                  station.az_mask.length
                    ? ` · ${t('passes.maskPoints', { count: station.az_mask.length })}`
                    : ''
                }}
              </small>
            </button>
            <v-btn
              icon
              size="x-small"
              variant="text"
              :aria-label="t('passes.editStation')"
              @click="startEdit(station)"
            >
              <Pencil :size="14" />
            </v-btn>
            <v-btn
              icon
              size="x-small"
              variant="text"
              :aria-label="t('passes.deleteStation')"
              :disabled="passes.stations.length < 2"
              @click="remove(station.id)"
            >
              <Trash2 :size="14" />
            </v-btn>
          </div>
          <div v-if="!passes.stations.length" class="empty-hint">{{ t('passes.noStations') }}</div>
        </div>
      </div>

      <div v-if="addMode" class="add-box">
        <v-btn-toggle v-model="addMode" class="segmented" :aria-label="t('passes.addMode')">
          <v-btn value="catalog">
            <Globe2 :size="14" class="mr-1" aria-hidden="true" />{{ t('passes.addFromCatalog') }}
          </v-btn>
          <v-btn value="manual">
            <PenLine :size="14" class="mr-1" aria-hidden="true" />{{ t('passes.addManual') }}
          </v-btn>
        </v-btn-toggle>
        <StationPicker v-if="addMode === 'catalog'" />
        <StationForm v-else key="new" :station="null" @cancel="closeForm" @saved="closeForm" />
      </div>

      <StationForm
        v-if="editing"
        :key="editing.id"
        :station="editing"
        @cancel="closeForm"
        @saved="closeForm"
      />

      <Sgp4OnlyNote :runs="runs.runs" />
      <v-btn
        color="primary"
        block
        :disabled="!runs.runs.length || !passes.selectedIds.length"
        :loading="passes.loading"
        @click="predict"
      >
        <Radar :size="15" class="mr-2" aria-hidden="true" />{{ t('passes.predict') }}
      </v-btn>
      <v-alert v-if="passes.error" type="error" variant="tonal" density="compact">{{
        apiErrorText(passes.error, t)
      }}</v-alert>

      <template v-if="passes.result">
        <p class="muted text-caption">{{ summary }}</p>
        <p v-if="stale" class="muted text-caption" data-testid="passes-stale">
          {{ t('passes.stale') }}
        </p>
        <ContactJumpToggle />
        <div class="pass-list-head">
          <v-btn size="x-small" variant="text" @click="passes.setAllPassesVisible(!anyShown)">
            <component :is="anyShown ? EyeOff : Eye" :size="13" class="mr-1" />
            {{ t(anyShown ? 'passes.hideAll' : 'passes.showAll') }}
          </v-btn>
          <span class="exports" role="group" :aria-label="t('passes.exportLabel')">
            <v-btn size="x-small" variant="text" @click="exportCsv">CSV</v-btn>
            <v-btn size="x-small" variant="text" @click="exportJson">JSON</v-btn>
          </span>
          <v-btn
            size="x-small"
            variant="tonal"
            color="primary"
            data-testid="pass-timeline-toggle"
            @click="passes.timelineOpen = !passes.timelineOpen"
          >
            <ChartGantt :size="13" class="mr-1" />
            {{ t(passes.timelineOpen ? 'passes.closeTimeline' : 'passes.openTimeline') }}
          </v-btn>
        </div>
        <div class="pass-list">
          <template v-for="(entry, index) in passes.timeline" :key="entry.pass.id">
            <p v-if="dayOf(index) !== dayOf(index - 1)" class="day-head">{{ dayOf(index) }} UTC</p>
            <PassRow
              :entry="entry"
              :station-name="label(entry.station)"
              :satellite-name="
                passes.multi ? passes.satelliteName(entry.pass.satellite_index) : undefined
              "
              :color="passColor(entry)"
              :number="passes.numberOf(passKey(entry.pass))"
              :active="isActive(entry.pass)"
              @pick="jump"
              @detail="(picked: TimelineEntry) => (detail = picked)"
            />
          </template>
          <div v-if="!passes.timeline.length" class="empty-hint">{{ t('passes.none') }}</div>
        </div>
        <v-alert
          v-for="warning in warningTexts(passes.result.warnings, t)"
          :key="warning"
          type="warning"
          variant="tonal"
          density="compact"
        >
          {{ warning }}
        </v-alert>
      </template>
    </div>
    <PassDetailDialog :entry="detail" @close="detail = null" />
  </DashboardCard>
</template>

<script setup lang="ts">
import {
  ChartGantt,
  ChevronUp,
  Eye,
  EyeOff,
  Globe2,
  Pencil,
  PenLine,
  Plus,
  Radar,
  RadioTower,
  Trash2,
} from 'lucide-vue-next'
import { computed, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '../i18n/useLocale'
import { apiErrorText, warningTexts } from '../api/messages'
import type { Pass, Station } from '../api/types'
import { useClockStore } from '../stores/clock'
import { MAX_STATIONS, passKey, usePassesStore, type TimelineEntry } from '../stores/passes'
import { useRunsStore } from '../stores/runs'
import { useUiStore } from '../stores/ui'
import { presetOf, stationLabel } from '../stations/presets'
import { stationColorHex } from '../theme/stationColors'
import { useThemePreset } from '../theme/useThemePreset'
import { saveText } from '../utils/download'
import { planCsv } from '../utils/passPlan'
import { jumpTarget } from '../utils/passTimeline'
import { revealWithinRuns } from '../utils/revealWithinRuns'
import { usePassColors } from '../utils/usePassColors'
import ContactJumpToggle from './ContactJumpToggle.vue'
import DashboardCard from './DashboardCard.vue'
import { formatUtc } from '../utils/time'
import PassDetailDialog from './PassDetailDialog.vue'
import PassRow from './PassRow.vue'
import PassSatelliteList from './PassSatelliteList.vue'
import Sgp4OnlyNote from './Sgp4OnlyNote.vue'
import StationForm from './StationForm.vue'
import StationPicker from './StationPicker.vue'

const { t } = useI18n()
const locale = useLocaleStore()
const passes = usePassesStore()
const runs = useRunsStore()
const clock = useClockStore()
const ui = useUiStore()
const theme = useThemePreset()
const { passColor } = usePassColors()
/** How a new station is being added, or null while that area is folded away. */
const addMode = ref<'catalog' | 'manual' | null>(null)
const editing = ref<Station | null>(null)
/** The pass whose detail dialog is open. */
const detail = shallowRef<TimelineEntry | null>(null)

/** Runs, stations or turnaround changed since the result was computed. */
const stale = computed(() => passes.resultSetup !== passes.setupKey(runs.runs))

const anyShown = computed(() => passes.timeline.length > passes.hidden.size)

/**
 * One station reads better with its own reach spelled out; several would just be a list,
 * so the per-station outlines on the globe and the timeline carry that instead.
 */
const summary = computed(() => {
  const results = passes.results
  const count = t('passes.count', { count: passes.timeline.length })
  const only = results.length === 1 ? results[0] : null
  const text = only
    ? t('passes.summaryOne', {
        count,
        radius: only.visibility.radius_km.toFixed(0),
        elevation: only.min_elev_deg,
      })
    : t('passes.summaryMany', { count, stations: results.length })
  const plan = passes.result
  if (!plan || !passes.multi) return text
  return `${text} · ${t('passes.summaryPlan', { assigned: plan.assigned, rejected: plan.rejected })}`
})

function label(station: Station) {
  return stationLabel(station, locale.locale)
}

function colorOf(id: number) {
  return stationColorHex(passes.colorIndexOf(id), theme.preset.globe.stationPalette)
}

function predict() {
  void passes.predict(runs.runs)
}

function jump(pass: Pass) {
  revealWithinRuns(clock, runs.runs, jumpTarget(pass, ui.contactJump))
}

function stamp() {
  return formatUtc(clock.currentMs, false)
    .replace(/[^0-9]/g, '')
    .slice(0, 12)
}

function exportCsv() {
  const plan = passes.result
  if (!plan) return
  const name = (id: number) => {
    const station = passes.stations.find((item) => item.id === id)
    return station ? label(station) : String(id)
  }
  saveText(`soda-passes-${stamp()}.csv`, planCsv(plan, passes.satelliteName, name), 'text/csv')
}

function exportJson() {
  if (!passes.result) return
  const text = `${JSON.stringify(passes.result, null, 2)}\n`
  saveText(`soda-passes-${stamp()}.json`, text, 'application/json')
}

/** UTC date of a row's AOS, so the list can break into days. */
function dayOf(index: number) {
  const entry = passes.timeline[index]
  return entry ? formatUtc(Date.parse(entry.pass.aos)).slice(0, 10) : ''
}

function isActive(pass: Pass) {
  return Date.parse(pass.aos) <= clock.currentMs && clock.currentMs <= Date.parse(pass.los)
}

function toggleAdd() {
  editing.value = null
  addMode.value = addMode.value ? null : 'catalog'
}

function startEdit(station: Station) {
  addMode.value = null
  editing.value = editing.value?.id === station.id ? null : station
}

function closeForm() {
  addMode.value = null
  editing.value = null
}

async function remove(id: number) {
  await passes.removeStation(id)
  if (editing.value?.id === id) closeForm()
}
</script>

<style scoped>
.add-box {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  padding: 10px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.035);
}
.station-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}
.station-list {
  display: grid;
  gap: 2px;
}
.pick {
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.pick:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.name {
  display: flex;
  align-items: center;
  gap: 6px;
}
.swatch {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.day-head {
  margin: 6px 0 0 10px;
  font-size: 11px;
  font-weight: 700;
  color: rgb(var(--v-theme-secondary));
  font-variant-numeric: tabular-nums;
}
.exports {
  display: flex;
  margin-left: auto;
}
.pass-list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pass-list {
  display: grid;
  /* Without the minmax a long AOS/LOS line widens the column past the card. */
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
}
</style>
