import type { Page } from '@playwright/test'

/** Opens a rail tool by its label; a click on the tool already open would fold it away. */
export async function openTool(page: Page, label: string) {
  const button = page.getByRole('button', { name: label, exact: true })
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
}

/** Opens the satellite tool on one of its pages (`pick`, `propagate`, `runs`). */
export async function openSatelliteStep(page: Page, step: 'pick' | 'propagate' | 'runs') {
  await openTool(page, 'Orbit propagation')
  await page.getByTestId(`satellite-step-${step}`).click()
}
