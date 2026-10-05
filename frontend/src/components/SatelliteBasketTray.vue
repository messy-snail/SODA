<template>
  <section class="tray" data-testid="satellite-basket" :aria-label="t('catalog.basket')">
    <header class="tray__head">
      <p class="section-label">
        <ListChecks :size="12" aria-hidden="true" />
        {{ t('catalog.basket') }}
        <span class="tray__count">{{ basket.items.length }}/{{ MAX_BASKET }}</span>
      </p>
      <v-btn
        v-if="basket.items.length"
        size="x-small"
        variant="text"
        data-testid="basket-clear"
        @click="basket.clear()"
      >
        {{ t('catalog.clearBasket') }}
      </v-btn>
    </header>
    <p v-if="!basket.items.length" class="tray__empty">{{ t('catalog.basketEmpty') }}</p>
    <div v-else class="tray__list">
      <SatelliteRow
        v-for="item in basket.items"
        :key="item.key"
        :sat-ref="item.ref"
        :name="item.name"
        :detail="rowDetail(item)"
        :category="basket.detailOf(item.ref)?.orbit.category"
      />
    </div>
    <p v-if="basket.refusedFull" class="field-note text-warning" role="status">
      {{ t('catalog.basketFull', { max: MAX_BASKET }) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { ListChecks } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { MAX_BASKET } from '../stores/basketItems'
import { useSatelliteBasketStore, type BasketItem } from '../stores/satelliteBasket'
import { customKind } from '../utils/satelliteRef'
import SatelliteRow from './SatelliteRow.vue'

const { t } = useI18n()
const basket = useSatelliteBasketStore()

function rowDetail(item: BasketItem): string {
  const detail = basket.detailOf(item.ref)
  const kind = customKind(item.ref)
  if (kind === 'state') return t('catalog.userState')
  if (kind === 'ephemeris') return t('catalog.userEphemeris')
  const norad = `NORAD ${detail?.norad_id ?? item.ref.noradId}`
  return kind ? `${norad} · ${t('catalog.userElements')}` : norad
}
</script>

<style scoped>
.tray {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2) var(--space-2);
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.05);
}
.tray__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 24px;
  padding-left: 4px;
}
.tray__head .section-label {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  color: rgb(var(--v-theme-primary));
}
.tray__count {
  font-weight: 600;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}
.tray__empty {
  margin: 0;
  padding: 2px 4px 4px;
  font-size: 12px;
  color: rgb(var(--v-theme-secondary));
}
.tray__list {
  display: grid;
  gap: 2px;
}
</style>
