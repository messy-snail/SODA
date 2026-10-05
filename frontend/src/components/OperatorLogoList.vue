<template>
  <div class="form-stack">
    <LogoSlot
      v-for="rule in domestic"
      :key="rule.slug"
      :name="rule.slug"
      :label="pick(rule.title, locale.locale)"
      :empty-text="t('markers.operatorHint')"
    />

    <v-btn size="small" variant="text" class="align-self-start" @click="showForeign = !showForeign">
      <component :is="showForeign ? ChevronUp : ChevronDown" :size="15" class="mr-1" />
      {{
        t('markers.foreignToggle', {
          count: foreign.length,
          action: showForeign ? t('markers.collapse') : t('markers.expand'),
        })
      }}
    </v-btn>

    <template v-if="showForeign">
      <LogoSlot
        v-for="rule in foreign"
        :key="rule.slug"
        :name="rule.slug"
        :label="pick(rule.title, locale.locale)"
        :empty-text="t('markers.operatorHint')"
      />
    </template>

    <div v-if="unknown.length" class="empty-hint">
      {{ t('markers.unknownLogos', { count: unknown.length }) }}
      {{ unknown.map((logo) => logo.name).join(', ') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChevronDown, ChevronUp } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { pick } from '../i18n/label'
import { useLocaleStore } from '../i18n/useLocale'
import { useLogosStore } from '../stores/logos'
import { OPERATOR_RULES } from '../utils/operators'
import LogoSlot from './LogoSlot.vue'

const { t } = useI18n()
const locale = useLocaleStore()
const logos = useLogosStore()
const showForeign = ref(false)

const domestic = computed(() => OPERATOR_RULES.filter((rule) => rule.domestic))
const foreign = computed(() => OPERATOR_RULES.filter((rule) => !rule.domestic))

/** Files dropped into `data/logos` by hand whose names match no rule, so nothing uses them. */
const unknown = computed(() => {
  const known = new Set(OPERATOR_RULES.map((rule) => rule.slug))
  return logos.items.filter((logo) => logo.operator && !known.has(logo.operator))
})
</script>
