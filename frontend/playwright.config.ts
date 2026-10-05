import { defineConfig } from '@playwright/test'

// Runs against a live `uv run soda serve` with a built frontend.
export default defineConfig({
  testDir: 'tests',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.SODA_URL ?? 'http://127.0.0.1:1992',
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',
    viewport: { width: 1600, height: 960 },
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
})
