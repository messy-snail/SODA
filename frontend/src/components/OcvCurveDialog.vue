<template>
  <v-dialog
    :model-value="modelValue"
    max-width="440"
    aria-labelledby="ocv-curve-title"
    @update:model-value="(open: boolean) => emit('update:modelValue', open)"
  >
    <v-card class="glass" elevation="0" rounded="lg" border data-testid="ocv-curve">
      <v-card-text class="form-stack">
        <div class="label-row">
          <p id="ocv-curve-title" class="eyebrow">{{ t('missionPower.curve.title') }}</p>
          <InfoTip :label="t('missionPower.curve.title')">
            <ul class="tip-list">
              <li>{{ t('missionPower.curve.format') }}</li>
              <li>{{ t('missionPower.curve.example') }}</li>
            </ul>
          </InfoTip>
        </div>
        <svg class="preview" viewBox="0 0 100 40" preserveAspectRatio="none" role="img">
          <polyline v-if="preview" :points="preview" />
        </svg>
        <v-textarea
          v-model="text"
          rows="8"
          no-resize
          class="mono-area"
          :label="t('missionPower.curve.points')"
          :error-messages="problem ? [t(`missionPower.curve.problems.${problem}`)] : []"
          data-testid="ocv-curve-text"
        />
        <div class="actions">
          <v-btn size="small" variant="text" @click="text = formatOcv(DEFAULT_OCV)">
            {{ t('missionPower.curve.reset') }}
          </v-btn>
          <v-spacer />
          <v-btn size="small" variant="text" @click="emit('update:modelValue', false)">
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn
            size="small"
            variant="tonal"
            color="primary"
            :disabled="!parsed.points"
            data-testid="ocv-curve-apply"
            @click="apply"
          >
            {{ t('common.apply') }}
          </v-btn>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_OCV, formatOcv, parseOcv, type OcvPoint } from '../mission/battery'
import InfoTip from './InfoTip.vue'

/**
 * The open-circuit voltage curve of one cell, typed as one `SOC %, V` point per line. It
 * lives in a dialog so the settings stay short; nothing changes until it is applied.
 */
const props = defineProps<{ modelValue: boolean; points: OcvPoint[] }>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean]; apply: [points: OcvPoint[]] }>()

const { t } = useI18n()
const text = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (open) text.value = formatOcv(props.points)
  },
  { immediate: true },
)

const parsed = computed(() => parseOcv(text.value))
const problem = computed(() => parsed.value.problem)

/** The curve drawn across the box, bottom to top between its lowest and highest voltage. */
const preview = computed(() => {
  const points = parsed.value.points
  if (!points) return ''
  const low = points[0]!.cellV
  const span = Math.max(points[points.length - 1]!.cellV - low, 1e-6)
  return points.map((p) => `${p.socPct},${38 - ((p.cellV - low) / span) * 36}`).join(' ')
})

function apply() {
  if (!parsed.value.points) return
  emit('apply', parsed.value.points)
  emit('update:modelValue', false)
}
</script>

<style scoped>
.label-row,
.actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.label-row .eyebrow {
  margin: 0;
}
.preview {
  width: 100%;
  height: 72px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.preview polyline {
  fill: none;
  stroke: rgb(var(--v-theme-primary));
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.mono-area :deep(textarea) {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}
</style>
