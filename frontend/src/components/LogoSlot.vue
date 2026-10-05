<template>
  <div class="logo-slot">
    <div class="slot-head">
      <span
        class="thumb"
        :class="{ empty: !logo }"
        :style="logo ? { background: theme.preset.globe.logoBackground } : undefined"
      >
        <img v-if="logo" :src="logoUrl(logo)" alt="" />
        <ImageIcon v-else :size="16" aria-hidden="true" />
      </span>
      <span class="grow">
        <strong>{{ label }}</strong>
        <small v-if="logo && logo.builtin">
          {{ t('markers.slot.builtin', { size: formatBytes(logo.size_bytes) }) }}
        </small>
        <small v-else-if="logo">
          {{ formatBytes(logo.size_bytes) }} · {{ formatUtc(Date.parse(logo.updated_at), false) }}
          UTC
        </small>
        <small v-else>{{ emptyText }}</small>
      </span>
      <v-btn size="small" variant="tonal" color="primary" :loading="busy" @click="pickFile">
        <Upload :size="14" class="mr-1" aria-hidden="true" />{{
          logo ? t('markers.slot.replace') : t('markers.slot.upload')
        }}
      </v-btn>
      <v-btn
        v-if="restorable"
        icon
        size="x-small"
        variant="text"
        :aria-label="t('markers.slot.revert')"
        :disabled="busy"
        @click="removeLogo"
      >
        <RotateCcw :size="15" />
      </v-btn>
      <v-btn
        v-else-if="deletable"
        icon
        size="x-small"
        variant="text"
        :aria-label="t('markers.slot.remove')"
        :disabled="busy"
        @click="removeLogo"
      >
        <Trash2 :size="15" />
      </v-btn>
      <input ref="fileInput" type="file" :accept="LOGO_ACCEPT" hidden @change="onFileChosen" />
    </div>
    <p v-if="error" class="text-error text-caption message">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ImageIcon, RotateCcw, Trash2, Upload } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { logoUrl } from '../api/client'
import { useI18n } from 'vue-i18n'
import { useLogosStore } from '../stores/logos'
import { useThemePreset } from '../theme/useThemePreset'
import { LOGO_ACCEPT } from '../utils/logos'
import { formatBytes } from '../utils/namedFiles'
import { formatUtc } from '../utils/time'

const props = defineProps<{ name: string; label: string; emptyText?: string }>()

const { t } = useI18n()
const logos = useLogosStore()
const theme = useThemePreset()
const logo = computed(() => logos.find(props.name))
/** An upload sits on top of a bundled logo, so it can be reverted rather than deleted. */
const restorable = computed(() => Boolean(logo.value?.has_builtin) && !logo.value?.builtin)
/** A bundled logo has no upload to remove; it can only be replaced. */
const deletable = computed(() => Boolean(logo.value) && !logo.value?.builtin)
const fileInput = ref<HTMLInputElement>()
const busy = ref(false)
const error = ref('')

async function run(task: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await task()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}

function pickFile() {
  fileInput.value?.click()
}

function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void run(() => logos.upload(props.name, file))
}

function removeLogo() {
  const question = restorable.value
    ? t('markers.slot.confirmRevert', { label: props.label })
    : t('markers.slot.confirmDelete', { label: props.label })
  if (!confirm(question)) return
  void run(() => logos.remove(props.name))
}
</script>

<style scoped>
.logo-slot {
  display: grid;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.slot-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.thumb {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 32px;
  height: 32px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  color: rgb(var(--v-theme-secondary));
}
.thumb.empty {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.grow {
  flex: 1;
  min-width: 0;
}
.grow strong {
  display: block;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grow small {
  display: block;
  font-size: 11px;
  color: rgb(var(--v-theme-secondary));
  font-variant-numeric: tabular-nums;
}
.message {
  margin: 0;
}
</style>
