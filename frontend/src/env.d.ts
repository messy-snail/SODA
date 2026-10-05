/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface ImportMetaEnv {
  /** Optional Cesium ion token enabling Bing Aerial imagery. */
  readonly VITE_CESIUM_ION_TOKEN?: string
  /** `1` shows the hidden GLB satellite model tools. */
  readonly VITE_SODA_GLB_MODELS?: string
  /** `1` shows the hidden coverage analysis tool. */
  readonly VITE_SODA_COVERAGE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
