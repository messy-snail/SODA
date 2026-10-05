import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { fileURLToPath, URL } from 'node:url'

// Cesium loads workers, textures, and widget CSS at runtime from CESIUM_BASE_URL.
const CESIUM_BASE = 'cesium'

export default defineConfig({
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/cesium/Build/Cesium/{Workers,ThirdParty,Assets,Widgets}/**/*',
          dest: CESIUM_BASE,
          rename: { stripBase: 4 },
        },
      ],
    }),
  ],
  define: { CESIUM_BASE_URL: JSON.stringify(`/${CESIUM_BASE}/`) },
  build: {
    outDir: fileURLToPath(new URL('../src/soda/static/dist', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
  },
  worker: { format: 'es' },
  server: {
    proxy: {
      // ws: the TC/TM simulator talks over a WebSocket under /api.
      '/api': { target: `http://127.0.0.1:${process.env.SODA_PORT ?? 1992}`, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
  },
})
