<template>
  <section class="form-stack" data-testid="reset-settings">
    <p class="section-label">{{ t('settings.reset.title') }}</p>
    <p class="muted text-caption">{{ t('settings.reset.hint') }}</p>
    <div v-if="!confirming">
      <v-btn variant="outlined" color="error" data-testid="reset-start" @click="confirming = true">
        <RotateCcw :size="15" aria-hidden="true" class="mr-2" />
        {{ t('settings.reset.action') }}
      </v-btn>
    </div>
    <v-alert v-else type="warning" variant="tonal" density="compact" data-testid="reset-confirm">
      <p>{{ t('settings.reset.confirm') }}</p>
      <div class="reset-actions">
        <v-btn size="small" variant="text" @click="confirming = false">
          {{ t('settings.reset.cancel') }}
        </v-btn>
        <v-btn size="small" color="error" data-testid="reset-run" @click="resetClientState()">
          {{ t('settings.reset.run') }}
        </v-btn>
      </div>
    </v-alert>
  </section>
</template>

<script setup lang="ts">
import { RotateCcw } from 'lucide-vue-next'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { resetClientState } from '../utils/resetClientState'

const { t } = useI18n()
const confirming = ref(false)
</script>

<style scoped>
.reset-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
</style>
