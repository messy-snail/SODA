<template>
  <div class="chart">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="label"
      @click="pick"
    >
      <rect
        v-for="(span, index) in shadeRects"
        :key="`shade-${index}`"
        class="shade"
        :x="span.x"
        :width="span.width"
        y="0"
        :height="H"
      />
      <rect
        v-for="(span, index) in alertRects"
        :key="`alert-${index}`"
        class="alert"
        :x="span.x"
        :width="span.width"
        y="0"
        :height="H"
      />
      <line
        v-for="tick in ticks"
        :key="tick.ms"
        class="grid"
        :x1="tick.at * W"
        :x2="tick.at * W"
        y1="0"
        :y2="H"
      />
      <line v-if="line !== undefined" class="limit" x1="0" :x2="W" :y1="y(line)" :y2="y(line)" />
      <polyline class="fill" :points="areaPoints" />
      <polyline class="level" :points="linePoints" />
      <line
        v-if="cursor !== null"
        class="cursor"
        :x1="cursor * W"
        :x2="cursor * W"
        y1="0"
        :y2="H"
      />
    </svg>
    <div class="axis">
      <span v-for="tick in ticks" :key="tick.ms" :style="tickStyle(tick.at)">
        {{ tickLabel(tick.ms) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LevelPoint, TimeSpan } from '../utils/levelChart'
import { timelineTicks } from '../utils/passTimeline'
import { formatUtc } from '../utils/time'

const W = 1000
const H = 120

/** A level over time: a filled line, a dashed limit, and bands behind it. */
const props = defineProps<{
  label: string
  points: LevelPoint[]
  /** Value at the top edge of the chart. */
  max: number
  /** Value at the bottom edge; zero when left out. */
  min?: number
  /** Value the dashed line marks. */
  line?: number
  startMs: number
  endMs: number
  /** Spans drawn as a problem, such as an overflow. */
  alerts: TimeSpan[]
  /** Spans drawn as a neutral background, such as an eclipse. */
  shades?: TimeSpan[]
  nowMs: number
}>()
const emit = defineEmits<{ seek: [ms: number] }>()

const span = computed(() => Math.max(props.endMs - props.startMs, 1))
const x = (ms: number) => ((ms - props.startMs) / span.value) * W
const y = (value: number) => {
  const low = props.min ?? 0
  return H - ((value - low) / Math.max(props.max - low, 1e-9)) * H
}

const linePoints = computed(() => props.points.map((p) => `${x(p.ms)},${y(p.value)}`).join(' '))
const areaPoints = computed(() => {
  const first = props.points[0]
  const last = props.points[props.points.length - 1]
  if (!first || !last) return ''
  return `${x(first.ms)},${H} ${linePoints.value} ${x(last.ms)},${H}`
})
const rects = (spans: TimeSpan[], minWidth: number) =>
  spans.map((s) => ({ x: x(s.startMs), width: Math.max(x(s.endMs) - x(s.startMs), minWidth) }))
const alertRects = computed(() => rects(props.alerts, 2))
const shadeRects = computed(() => rects(props.shades ?? [], 0))
const ticks = computed(() => timelineTicks(props.startMs, props.endMs, 5))
const cursor = computed(() =>
  props.nowMs >= props.startMs && props.nowMs <= props.endMs
    ? (props.nowMs - props.startMs) / span.value
    : null,
)

function tickLabel(ms: number) {
  const text = formatUtc(ms, false)
  return span.value <= 86_400_000 ? text.slice(11, 16) : text.slice(5, 10)
}

/** Labels near an edge hang inward so the chart does not clip them. */
function tickStyle(at: number) {
  const shift = at < 0.06 ? '0' : at > 0.94 ? '-100%' : '-50%'
  return { left: `${at * 100}%`, transform: `translateX(${shift})` }
}

function pick(event: MouseEvent) {
  const box = (event.currentTarget as SVGElement).getBoundingClientRect()
  const fraction = (event.clientX - box.left) / box.width
  emit('seek', props.startMs + fraction * span.value)
}
</script>

<style scoped>
.chart {
  position: relative;
  padding-bottom: 14px;
}
svg {
  display: block;
  width: 100%;
  height: 120px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  cursor: crosshair;
}
.grid {
  stroke: rgba(var(--v-theme-on-surface), 0.08);
  vector-effect: non-scaling-stroke;
}
.limit {
  stroke: rgb(var(--v-theme-error));
  stroke-dasharray: 4 3;
  vector-effect: non-scaling-stroke;
}
.fill {
  fill: rgba(var(--v-theme-primary), 0.18);
  stroke: none;
}
.level {
  fill: none;
  stroke: rgb(var(--v-theme-primary));
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.alert {
  fill: rgba(var(--v-theme-error), 0.22);
}
.shade {
  fill: rgba(var(--v-theme-on-surface), 0.1);
}
.cursor {
  stroke: rgb(var(--v-theme-warning));
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.axis {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 12px;
}
.axis span {
  position: absolute;
  font-size: 9.5px;
  color: rgb(var(--v-theme-secondary));
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
