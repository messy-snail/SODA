import type { InjectionKey } from 'vue'

/** Set by every `DashboardCard` for its descendants, so a nested card renders as a section. */
export const EMBEDDED_CARD: InjectionKey<boolean> = Symbol('embedded-card')
