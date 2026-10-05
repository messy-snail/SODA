import { defineConfig } from '@playwright/test'

// Records the README clips in `demos/` against a live `uv run soda serve` with a built
// frontend. Kept apart from `playwright.config.ts` so the smoke run never picks them up.
// `SODA_DEMO_HEADED=1` records in a real window on the GPU instead of SwiftShader.
const headed = Boolean(process.env.SODA_DEMO_HEADED)

export default defineConfig({
  testDir: 'demos',
  testMatch: '*.demo.ts',
  outputDir: '../.cache/demo-results',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.SODA_URL ?? 'http://127.0.0.1:1992',
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',
    headless: !headed,
    viewport: { width: 1280, height: 768 },
    actionTimeout: 20_000,
    // Native date fields ignore this and follow the language of the machine's browser.
    locale: 'en-US',
    launchOptions: {
      args: headed ? [] : ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
})
