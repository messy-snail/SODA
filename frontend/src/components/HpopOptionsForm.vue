<template>
  <div class="form-stack" data-testid="hpop-options">
    <div>
      <p class="section-label">{{ t('propagate.hpop.gravity') }}</p>
      <v-btn-toggle
        v-model="form.gravityDegree"
        class="segmented"
        :aria-label="t('propagate.hpop.gravity')"
        data-testid="hpop-gravity"
      >
        <v-btn v-for="degree in GRAVITY_DEGREES" :key="degree" :value="degree">
          {{ degree === 2 ? t('propagate.hpop.j2') : `${degree}×${degree}` }}
        </v-btn>
      </v-btn-toggle>
    </div>
    <div class="forces">
      <v-switch
        v-model="form.thirdBody"
        :label="t('propagate.hpop.thirdBody')"
        data-testid="hpop-third-body"
      />
      <v-switch v-model="form.drag" :label="t('propagate.hpop.drag')" data-testid="hpop-drag" />
      <v-switch v-model="form.srp" :label="t('propagate.hpop.srp')" data-testid="hpop-srp" />
    </div>
    <div v-if="form.drag || form.srp" class="craft">
      <v-text-field
        v-model="form.massKg"
        type="number"
        min="0"
        :label="t('propagate.hpop.mass')"
        :placeholder="t('propagate.hpop.estimated')"
        persistent-placeholder
        data-testid="hpop-mass"
      />
      <v-text-field
        v-model="form.areaM2"
        type="number"
        min="0"
        :label="t('propagate.hpop.area')"
        :placeholder="t('propagate.hpop.estimated')"
        persistent-placeholder
        data-testid="hpop-area"
      />
      <v-text-field
        v-if="form.drag"
        v-model="form.cd"
        type="number"
        min="0"
        :label="t('propagate.hpop.cd')"
        placeholder="2.2"
        persistent-placeholder
      />
      <v-text-field
        v-if="form.srp"
        v-model="form.cr"
        type="number"
        min="0"
        :label="t('propagate.hpop.cr')"
        placeholder="1.3"
        persistent-placeholder
      />
    </div>
    <p v-if="form.drag || form.srp" class="muted text-caption note">
      {{ t('propagate.hpop.craftHint') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { GRAVITY_DEGREES, type HpopForm } from '../orbit/propagatorOptions'

/** Force model switches and spacecraft parameters for an HPOP run. */
const form = defineModel<HpopForm>({ required: true })
const { t } = useI18n()
</script>

<style scoped>
.forces {
  display: grid;
  gap: var(--space-1);
}
.craft {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
.note {
  margin: calc(var(--space-1) - var(--stack-gap)) 0 0;
}
</style>
