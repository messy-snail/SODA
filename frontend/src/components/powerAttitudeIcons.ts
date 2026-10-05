import { Earth, RadioTower, Sun } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { ContactAttitude } from '../api/types'

/** What the body looks at in each contact attitude. */
export const ATTITUDE_ICONS: Record<ContactAttitude, Component> = {
  sun: Sun,
  nadir: Earth,
  station: RadioTower,
}
