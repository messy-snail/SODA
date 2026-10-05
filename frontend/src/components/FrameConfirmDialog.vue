<template>
  <v-dialog v-model="layers.confirmInertial" max-width="440" aria-labelledby="eci-confirm-title">
    <v-card class="frame-dialog glass" elevation="0" rounded="lg" border>
      <v-card-title id="eci-confirm-title">{{ t('propagate.runs.eciTitle') }}</v-card-title>
      <v-card-text>{{ t('propagate.runs.eciWarning') }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="layers.confirmInertial = false">{{ t('common.cancel') }}</v-btn>
        <v-btn color="primary" @click="layers.acceptInertial()">{{
          t('propagate.runs.eciConfirm')
        }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useLayersStore } from '../stores/layers'

const { t } = useI18n()
const layers = useLayersStore()
</script>

<style scoped>
.frame-dialog {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}
</style>
