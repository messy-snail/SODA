<template>
  <v-app :theme="theme.preset.id">
    <v-main class="soda-main">
      <div class="stage" :class="{ 'has-left': !!ui.activeTool }">
        <GlobeViewer />
        <SodaAppBar />
        <ToolRail />
        <FrameLegend />
        <EpochTrustOverlay />
        <ContactChips />
        <SwathBusyOverlay />
        <ScaleBar />
        <ToolSidebar v-if="ui.activeTool" :label="toolLabel">
          <SatelliteToolCard v-if="ui.activeTool === 'satellite'" />
          <SwathInspectorCard v-else-if="ui.activeTool === 'swath'" />
          <PassPredictionCard v-else-if="ui.activeTool === 'passes'" />
          <ImagingToolCard v-else-if="ui.activeTool === 'imaging'" />
          <CoverageToolCard v-else-if="COVERAGE && ui.activeTool === 'coverage'" />
          <StorageToolCard v-else-if="ui.activeTool === 'storage'" />
          <PowerToolCard v-else-if="ui.activeTool === 'power'" />
          <TmtcToolCard v-else-if="ui.activeTool === 'tmtc'" />
          <ModelsCard v-else-if="GLB_MODELS && ui.activeTool === 'models'" />
          <ViewToolCard v-else />
        </ToolSidebar>
        <div class="bottom-dock">
          <DockTray :timeline-available="passDockOpen" />
          <div class="timeline-dock">
            <PassTimelineDock
              v-if="passDockOpen && (ui.timelinePinned || ui.dockPeek === 'timeline')"
              :class="{ 'dock-peek': !ui.timelinePinned }"
              @mouseenter="hold('timeline', ui.timelinePinned)"
              @mouseleave="ui.peek.leave()"
              @focusin="hold('timeline', ui.timelinePinned)"
              @focusout="ui.peek.leave()"
              @keydown.esc="ui.peek.close()"
            />
            <TimelineBar
              v-if="ui.clockPinned || ui.dockPeek === 'clock'"
              :class="{ 'dock-peek': !ui.clockPinned }"
              @mouseenter="hold('clock', ui.clockPinned)"
              @mouseleave="ui.peek.leave()"
              @focusin="hold('clock', ui.clockPinned)"
              @focusout="ui.peek.leave()"
              @keydown.esc="ui.peek.close()"
            />
          </div>
        </div>
        <FrameConfirmDialog />
        <v-snackbar
          :model-value="ui.restoreNotice !== null"
          location="top"
          class="restore-snackbar"
          timeout="8000"
          data-testid="restore-notice"
          @update:model-value="(open: boolean) => !open && (ui.restoreNotice = null)"
        >
          {{ ui.restoreNotice ? t(`app.restored.${ui.restoreNotice}`) : '' }}
          <template #actions>
            <v-btn variant="text" @click="ui.restoreNotice = null">
              {{ t('app.restored.close') }}
            </v-btn>
          </template>
        </v-snackbar>
      </div>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import ContactChips from './components/ContactChips.vue'
import EpochTrustOverlay from './components/EpochTrustOverlay.vue'
import DockTray from './components/DockTray.vue'
import FrameConfirmDialog from './components/FrameConfirmDialog.vue'
import FrameLegend from './components/FrameLegend.vue'
import GlobeViewer from './components/GlobeViewer.vue'
import CoverageToolCard from './components/CoverageToolCard.vue'
import ImagingToolCard from './components/ImagingToolCard.vue'
import ModelsCard from './components/ModelsCard.vue'
import PassPredictionCard from './components/PassPredictionCard.vue'
import PassTimelineDock from './components/PassTimelineDock.vue'
import PowerToolCard from './components/PowerToolCard.vue'
import SatelliteToolCard from './components/SatelliteToolCard.vue'
import ScaleBar from './components/ScaleBar.vue'
import SodaAppBar from './components/SodaAppBar.vue'
import StorageToolCard from './components/StorageToolCard.vue'
import SwathBusyOverlay from './components/SwathBusyOverlay.vue'
import SwathInspectorCard from './components/SwathInspectorCard.vue'
import TimelineBar from './components/TimelineBar.vue'
import TmtcToolCard from './components/TmtcToolCard.vue'
import ToolRail from './components/ToolRail.vue'
import ToolSidebar from './components/ToolSidebar.vue'
import ViewToolCard from './components/ViewToolCard.vue'
import { COVERAGE, GLB_MODELS } from './features'
import { useAppearanceStore } from './stores/appearance'
import { useCatalogStore } from './stores/catalog'
import { useImageryStore } from './stores/imagery'
import { useLogosStore } from './stores/logos'
import { useModelsStore } from './stores/models'
import { usePassesStore } from './stores/passes'
import { useTmtcStore } from './stores/tmtc'
import { useUiStore, type DockPiece } from './stores/ui'
import { useThemePreset } from './theme/useThemePreset'
import { useHotkeys } from './utils/useHotkeys'

const { t } = useI18n()
const theme = useThemePreset()
const ui = useUiStore()
const catalog = useCatalogStore()
const passes = usePassesStore()
const tmtc = useTmtcStore()
const models = useModelsStore()
const logos = useLogosStore()
const imagery = useImageryStore()
useHotkeys()
// Applies the stored glass look to the document before the panels paint.
useAppearanceStore()

const passDockOpen = computed(() => passes.timelineOpen && !!passes.result)

/** Keeps an unpinned piece popped up while the pointer or focus is on it. */
function hold(piece: DockPiece, pinned: boolean) {
  if (!pinned) ui.peek.enter(piece)
}

const toolLabel = computed(() => (ui.activeTool ? t(`app.tool.${ui.activeTool}.label`) : undefined))

onMounted(() => {
  catalog.startPolling()
  void passes.loadStations()
  void logos.load()
  // A session outlives a reload (the server keeps it), so its chip and link come back too.
  void tmtc.resume()
  void imagery.load()
  if (GLB_MODELS) void models.load()
})
</script>
