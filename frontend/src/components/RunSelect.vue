<template>
  <v-menu v-model="open" location="bottom" :offset="4" max-height="320" :width="menuWidth">
    <template #activator="{ props: menu }">
      <button
        v-bind="menu"
        ref="button"
        type="button"
        class="run-picker"
        :class="{ 'run-picker--open': open, 'run-picker--compact': !showLabel }"
        aria-haspopup="listbox"
        :aria-label="label"
        :data-testid="testId"
      >
        <span v-if="showLabel" class="run-picker__label">{{ label }}</span>
        <span class="run-picker__body">
          <template v-if="current">
            <span class="dot" :style="{ background: current.color }" aria-hidden="true" />
            <span class="text">
              <span class="name">
                <small v-if="!showLabel" class="inline-label">{{ label }}</small>
                <strong>{{ current.title }}</strong>
              </span>
              <small
                ><slot name="subtitle" :run="current.run">{{ current.subtitle }}</slot></small
              >
            </span>
          </template>
          <span v-else class="text muted">{{ placeholder }}</span>
          <ChevronDown :size="16" class="chevron" aria-hidden="true" />
        </span>
      </button>
    </template>
    <v-card class="run-menu" role="listbox" :aria-label="label">
      <button
        v-for="item in items"
        :key="item.value"
        type="button"
        role="option"
        class="list-row"
        :class="{ selected: item.value === modelValue }"
        :aria-selected="item.value === modelValue"
        @click="choose(item.value)"
      >
        <span class="dot" :style="{ background: item.color }" aria-hidden="true" />
        <span class="grow">
          <strong>{{ item.title }}</strong>
          <small>{{ item.subtitle }}</small>
        </span>
        <Check
          v-if="item.value === modelValue"
          :size="15"
          class="text-primary"
          aria-hidden="true"
        />
      </button>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { Check, ChevronDown } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OrbitRun } from '../stores/runs'
import { orbitColorHex } from '../theme/runColors'
import { useThemePreset } from '../theme/useThemePreset'
import { formatUtc } from '../utils/time'
import { useTimeText } from '../utils/useTimeText'

/**
 * Picker of one propagated run, coloured like its orbit line so the globe and the list
 * agree. With `showLabel` the label sits on its own row above; without it, it is tucked in
 * before the name so the picker stays two lines tall inside a tool panel.
 */
const props = defineProps<{
  runs: readonly OrbitRun[]
  /** Id of the run shown as current; null shows the placeholder. */
  modelValue: string | null
  label: string
  showLabel?: boolean
  placeholder?: string
  testId?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [id: string] }>()

const { t } = useI18n()
const theme = useThemePreset()
const { formatAgo } = useTimeText()
const open = ref(false)
const button = ref<HTMLButtonElement | null>(null)
/** The list opens as wide as the picker, like a select would. */
const menuWidth = ref<number>()
watch(open, (isOpen) => {
  if (isOpen) menuWidth.value = button.value?.offsetWidth
})

const items = computed(() =>
  props.runs.map((run) => ({
    run,
    title: run.name,
    value: run.id,
    color: orbitColorHex(run.colorIndex, theme.preset.globe.orbitPalette),
    subtitle: `NORAD ${run.noradId} · ${epochText(run.data.element_set.epoch)}`,
  })),
)
/** Which element set the run came from, and how old it is now. */
function epochText(epoch: string): string {
  const ms = Date.parse(epoch)
  return t('common.runSelect.epoch', { epoch: formatUtc(ms, false), ago: formatAgo(ms) })
}
const current = computed(() => items.value.find((item) => item.value === props.modelValue))

function choose(id: string) {
  emit('update:modelValue', id)
  open.value = false
}
</script>

<style scoped>
.run-picker {
  display: grid;
  gap: 2px;
  width: 100%;
  min-width: 0;
  padding: 7px 12px 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 140ms,
    background 140ms;
}
.run-picker--compact {
  padding: 3px 10px 4px;
}
.run-picker:hover,
.run-picker--open {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.05);
}
.run-picker:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}
.run-picker__label {
  font-size: 10.5px;
  font-weight: 650;
  color: rgb(var(--v-theme-secondary));
}
.run-picker__body {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 34px;
}
.text {
  display: grid;
  flex: 1;
  min-width: 0;
}
.name {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.inline-label {
  flex: none;
  font-weight: 650;
}
.text strong {
  overflow: hidden;
  font-size: 13.5px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.text small {
  overflow: hidden;
  font-size: 11px;
  color: rgb(var(--v-theme-secondary));
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chevron {
  flex-shrink: 0;
  opacity: 0.7;
  transition: transform 160ms;
}
.run-picker--open .chevron {
  transform: rotate(180deg);
}
.dot {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.run-menu {
  display: grid;
  gap: 2px;
  padding: var(--space-1);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px !important;
  background: rgb(var(--v-theme-surface)) !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3) !important;
}
</style>
