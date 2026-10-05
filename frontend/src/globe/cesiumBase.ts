// Must be imported before any Cesium module so runtime assets resolve under /cesium/.
declare const CESIUM_BASE_URL: string
;(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE_URL

export {}
