<template>
  <v-btn-toggle
    v-model="ui.contactJump"
    class="segmented"
    mandatory
    :aria-label="t('passes.jump.label')"
    data-testid="contact-jump"
  >
    <v-btn value="aos" size="small">{{ t('passes.jump.aos') }}</v-btn>
    <v-btn value="tca" size="small">{{ t('passes.jump.tca') }}</v-btn>
  </v-btn-toggle>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useUiStore } from '../stores/ui'

/**
 * Where a click on a contact or pass puts the clock. One setting for the pass list, the
 * pass timeline, the globe and the contact plan, so they all agree.
 */
const { t } = useI18n()
const ui = useUiStore()
</script>
