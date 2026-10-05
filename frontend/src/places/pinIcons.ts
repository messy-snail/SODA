import {
  Building2,
  Crosshair,
  Flag,
  House,
  MapPin,
  RadioTower,
  Rocket,
  Star,
} from 'lucide-vue-next'
import { markRaw, type Component } from 'vue'

/** Pin kinds; names live in the message catalogue under `places.pins.icon.<id>`. */
export const PIN_ICONS = [
  'pin',
  'star',
  'flag',
  'home',
  'antenna',
  'rocket',
  'target',
  'building',
] as const
export type PinIcon = (typeof PIN_ICONS)[number]

/** Lucide glyph for each kind; the card and the globe marker draw the same one. */
export const PIN_GLYPHS: Record<PinIcon, Component> = {
  pin: markRaw(MapPin),
  star: markRaw(Star),
  flag: markRaw(Flag),
  home: markRaw(House),
  antenna: markRaw(RadioTower),
  rocket: markRaw(Rocket),
  target: markRaw(Crosshair),
  building: markRaw(Building2),
}

export function isPinIcon(value: unknown): value is PinIcon {
  return (PIN_ICONS as readonly unknown[]).includes(value)
}
