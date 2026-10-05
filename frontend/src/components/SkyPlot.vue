<template>
  <svg class="sky" viewBox="-120 -120 240 240" role="img" :aria-label="label">
    <circle class="ground" :r="R" />
    <path v-if="horizonPath" class="horizon" :d="horizonPath" fill-rule="evenodd" />
    <circle v-for="ring in RINGS" :key="ring" class="grid" :r="((90 - ring) / 90) * R" />
    <line class="grid" :x1="-R" :x2="R" y1="0" y2="0" />
    <line class="grid" x1="0" x2="0" :y1="-R" :y2="R" />
    <text v-for="mark in COMPASS" :key="mark.text" class="compass" :x="mark.x" :y="mark.y">
      {{ mark.text }}
    </text>
    <polyline
      class="track"
      :points="trackPoints"
      :style="{ stroke: color }"
      data-testid="sky-track"
    />
    <g v-for="mark in marks" :key="mark.text">
      <circle class="mark" :cx="mark.x" :cy="mark.y" r="3.5" :style="{ fill: color }" />
      <text class="mark-label" :x="mark.x + mark.dx" :y="mark.y + 3.5" :text-anchor="mark.anchor">
        {{ mark.text }}
      </text>
    </g>
    <circle v-if="nowPoint" class="now" :cx="nowPoint[0]" :cy="nowPoint[1]" r="5" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AzMaskPoint } from '../api/types'
import {
  requiredElevationDeg,
  skyPoint,
  type LookAngles,
  type PassSample,
} from '../orbit/passGeometry'

/** Radius of the horizon circle in viewBox units, sized so text is ordinary pixels. */
const R = 100
const RINGS = [0, 30, 60]
const COMPASS = [
  { text: 'N', x: 0, y: -106 },
  { text: 'E', x: 110, y: 4 },
  { text: 'S', x: 0, y: 115 },
  { text: 'W', x: -110, y: 4 },
]
const HORIZON_STEP_DEG = 2

/** One pass across the sky of its station: zenith in the middle, north up. */
const props = defineProps<{
  label: string
  samples: PassSample[]
  /** Colour of the pass, as drawn on the globe. */
  color: string
  minElevDeg: number
  mask: AzMaskPoint[]
  /** Labels of the first, highest and last sample. */
  markLabels: [string, string, string]
  /** Where the satellite is at the clock's time, or null outside the pass. */
  now: LookAngles | null
}>()

const scaled = (azimuthDeg: number, elevationDeg: number) =>
  skyPoint(azimuthDeg, elevationDeg).map((value) => value * R) as [number, number]
const point = (look: LookAngles) => scaled(look.azimuthDeg, look.elevationDeg)
const fixed = (value: number) => value.toFixed(2)

const trackPoints = computed(() =>
  props.samples.map((sample) => point(sample).map(fixed).join(',')).join(' '),
)

/** The band between the rim and the elevation the station needs, mask included. */
const horizonPath = computed(() => {
  const inner: string[] = []
  let highest = 0
  for (let az = 0; az < 360; az += HORIZON_STEP_DEG) {
    const elevation = requiredElevationDeg(props.minElevDeg, props.mask, az)
    highest = Math.max(highest, elevation)
    inner.push(scaled(az, elevation).map(fixed).join(' '))
  }
  if (highest <= 0) return ''
  return `M ${-R} 0 A ${R} ${R} 0 1 0 ${R} 0 A ${R} ${R} 0 1 0 ${-R} 0 Z M ${inner.join(' L ')} Z`
})

const marks = computed(() => {
  const samples = props.samples
  if (!samples.length) return []
  const peak = samples.reduce((best, sample) =>
    sample.elevationDeg > best.elevationDeg ? sample : best,
  )
  return [samples[0]!, peak, samples[samples.length - 1]!].map((sample, i) => {
    const [x, y] = point(sample)
    // Labels sit on the side away from the centre line so they stay inside the box.
    const left = x > 55
    return {
      text: props.markLabels[i]!,
      x,
      y,
      dx: left ? -7 : 7,
      anchor: left ? 'end' : 'start',
    }
  })
})

const nowPoint = computed(() => (props.now ? point(props.now) : null))
</script>

<style scoped>
.sky {
  display: block;
  width: 100%;
  max-width: 260px;
  aspect-ratio: 1;
  margin: 0 auto;
}
.ground {
  fill: rgba(var(--v-theme-on-surface), 0.04);
}
.horizon {
  fill: rgba(var(--v-theme-on-surface), 0.12);
}
.grid {
  fill: none;
  stroke: rgba(var(--v-theme-on-surface), 0.14);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.compass {
  font-size: 11px;
  fill: rgb(var(--v-theme-secondary));
  text-anchor: middle;
}
/* The anchor is set per label, on the side that keeps it inside the box. */
.mark-label {
  font-size: 9.5px;
  font-weight: 700;
  fill: rgb(var(--v-theme-on-surface));
}
.track {
  fill: none;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.now {
  fill: rgb(var(--v-theme-warning));
  stroke: rgb(var(--v-theme-surface));
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
</style>
