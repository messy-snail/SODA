<template>
  <div class="form-stack" data-testid="mission-tmtc">
    <p class="muted text-caption">{{ t('missionTmtc.intro') }}</p>
    <Sgp4OnlyNote :runs="notedRuns" />

    <div v-if="!run" class="empty-hint">
      {{ t('missionTmtc.needRun') }}
      <br />
      <v-btn
        size="small"
        variant="tonal"
        color="primary"
        class="mt-2"
        @click="ui.openSatelliteStep('pick')"
      >
        {{ t('missionTmtc.toPropagate') }}
      </v-btn>
    </div>
    <template v-else-if="!tmtc.view.active">
      <RunSelect
        :runs="target.eligible.value"
        :model-value="run.id"
        :label="t('mission.target')"
        test-id="target-run-select"
        @update:model-value="target.select"
      >
        <template #subtitle>
          {{ t('missionTmtc.stations', { count: passes.selectedIds.length }) }}
        </template>
      </RunSelect>
      <v-btn
        color="primary"
        block
        :disabled="!passes.selectedIds.length"
        :loading="tmtc.loading"
        data-testid="tmtc-start"
        @click="start"
      >
        <Play :size="15" class="mr-2" aria-hidden="true" />{{ t('missionTmtc.start') }}
      </v-btn>
    </template>
    <template v-else>
      <div class="session-head">
        <span class="muted text-caption">
          {{ t('missionTmtc.running', { name: tmtc.name }) }}
          <i class="dot" :class="{ on: tmtc.connected }" aria-hidden="true" />
        </span>
        <v-btn size="small" variant="text" data-testid="tmtc-stop" @click="tmtc.stop()">
          <Square :size="13" class="mr-1" aria-hidden="true" />{{ t('missionTmtc.stop') }}
        </v-btn>
      </div>

      <div class="stat-grid" data-testid="tmtc-link">
        <div class="stat">
          <span>{{ t('missionTmtc.link') }}</span>
          <strong :class="link?.open ? 'text-success' : 'muted'">
            {{ t(link?.open ? 'missionTmtc.open' : 'missionTmtc.closed') }}
          </strong>
          <small v-if="link?.open && link.station_id !== null">
            {{ stationName(link.station_id) }}
          </small>
        </div>
        <div class="stat">
          <span>{{ t(link?.open ? 'missionTmtc.delay' : 'missionTmtc.nextAos') }}</span>
          <strong>{{ link?.open ? (link.delay_ms ?? 0).toFixed(1) : nextAos }}</strong>
          <small v-if="link?.open">ms</small>
        </div>
        <div class="stat">
          <span>{{ t('missionTmtc.queued') }}</span
          ><strong>{{ link?.queued ?? 0 }}</strong>
        </div>
        <div class="stat">
          <span>{{ t('missionTmtc.onboard') }}</span
          ><strong>{{ link?.onboard ?? 0 }}</strong>
        </div>
      </div>

      <v-btn
        v-if="link && !link.open && link.next_aos_ms"
        size="small"
        variant="tonal"
        color="primary"
        block
        data-testid="tmtc-next-aos"
        @click="clock.reveal(link.next_aos_ms + AOS_MARGIN_MS)"
      >
        <SkipForward :size="14" class="mr-2" aria-hidden="true" />{{ t('missionTmtc.toNextAos') }}
      </v-btn>

      <div v-if="hk" class="stat-grid" data-testid="tmtc-hk">
        <div class="stat">
          <span>{{ t('missionTmtc.mode') }}</span
          ><strong>{{ hk.mode }}</strong>
        </div>
        <div class="stat">
          <span>{{ t('missionTmtc.battery') }}</span
          ><strong>{{ hk.battery_pct }}</strong
          ><small>%</small>
        </div>
        <div class="stat">
          <span>{{ t('missionTmtc.storage') }}</span
          ><strong>{{ hk.storage_pct }}</strong
          ><small>%</small>
        </div>
        <div class="stat">
          <span>{{ t('missionTmtc.commands') }}</span>
          <strong>{{ hk.command_count }}</strong>
          <small>{{ t('missionTmtc.rejected', { count: hk.rejected_count }) }}</small>
        </div>
      </div>
      <p v-else class="muted text-caption">{{ t('missionTmtc.noHk') }}</p>

      <div class="form-stack command">
        <v-btn-toggle v-model="kind" class="segmented" mandatory>
          <v-btn value="NOOP">NOOP</v-btn>
          <v-btn value="SET_MODE">{{ t('missionTmtc.setMode') }}</v-btn>
          <v-btn value="TIME_TAG">{{ t('missionTmtc.timeTag') }}</v-btn>
        </v-btn-toggle>
        <div v-if="kind !== 'NOOP'" class="form-pair">
          <v-select v-model="mode" :items="MODES" :label="t('missionTmtc.mode')" />
          <v-text-field
            v-if="kind === 'TIME_TAG'"
            v-model.number="delayMin"
            type="number"
            min="1"
            :label="t('missionTmtc.after')"
          />
        </div>
        <v-btn color="primary" variant="tonal" data-testid="tmtc-send" @click="send">
          <Send :size="14" class="mr-2" aria-hidden="true" />{{ t('missionTmtc.send') }}
        </v-btn>
        <p class="muted text-caption">{{ t('missionTmtc.sendHint') }}</p>
      </div>

      <p class="section-label">{{ t('missionTmtc.log') }}</p>
      <TmtcPacketLog :entries="tmtc.view.log" />
    </template>

    <v-alert v-if="tmtc.error" type="error" variant="tonal" density="compact">{{
      apiErrorText(tmtc.error, t)
    }}</v-alert>
  </div>
</template>

<script setup lang="ts">
import { Play, Send, SkipForward, Square } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorText } from '../api/messages'
import type { SpacecraftMode, TmtcCommand } from '../api/types'
import { useLocaleStore } from '../i18n/useLocale'
import { useTargetRun } from '../orbit/useTargetRun'
import { stationLabel } from '../stations/presets'
import { useClockStore } from '../stores/clock'
import { usePassesStore } from '../stores/passes'
import { useTmtcStore } from '../stores/tmtc'
import { useUiStore } from '../stores/ui'
import { formatCountdown } from '../utils/passTimeline'
import RunSelect from './RunSelect.vue'
import Sgp4OnlyNote from './Sgp4OnlyNote.vue'
import TmtcPacketLog from './TmtcPacketLog.vue'

const MODES: SpacecraftMode[] = ['SAFE', 'NOMINAL', 'IMAGING']
/** A jump lands just inside the contact, so a paused clock still finds the link open. */
const AOS_MARGIN_MS = 1000

/**
 * A toy spacecraft that only talks while a selected station sees the selected run. The
 * clock drives it: play the timeline through a pass to see telemetry come down.
 */
const { t } = useI18n()
const locale = useLocaleStore()
const tmtc = useTmtcStore()
const passes = usePassesStore()
const clock = useClockStore()
const ui = useUiStore()
const kind = ref<TmtcCommand['command']>('NOOP')
const mode = ref<SpacecraftMode>('IMAGING')
const delayMin = ref(10)

const target = useTargetRun({ elementsOnly: true })
const run = target.run
const notedRuns = target.noted
const link = computed(() => tmtc.view.link)
const hk = computed(() => tmtc.view.hk)
const nextAos = computed(() => {
  const at = link.value?.next_aos_ms
  return at ? formatCountdown(at - clock.currentMs) : '—'
})

function stationName(id: number) {
  const station = passes.stations.find((item) => item.id === id)
  return station ? stationLabel(station, locale.locale) : String(id)
}

function start() {
  if (run.value) void tmtc.start(run.value, [...passes.selectedIds])
}

function send() {
  if (kind.value === 'NOOP') tmtc.send({ command: 'NOOP' })
  else if (kind.value === 'SET_MODE') tmtc.send({ command: 'SET_MODE', mode: mode.value })
  else {
    tmtc.send({
      command: 'TIME_TAG',
      execute_ms: Math.round(clock.currentMs + Math.max(1, delayMin.value) * 60_000),
      inner: { command: 'SET_MODE', mode: mode.value },
    })
  }
}

onMounted(() => {
  if (!tmtc.view.active) void tmtc.resume()
})
</script>

<style scoped>
.session-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-left: 4px;
  border-radius: 50%;
  background: rgb(var(--v-theme-error));
}
.dot.on {
  background: rgb(var(--v-theme-success));
}
.stat small {
  display: block;
  font-size: 10.5px;
  color: rgb(var(--v-theme-secondary));
}
.command {
  padding: 10px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.035);
}
</style>
