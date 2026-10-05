import type { APIRequestContext } from '@playwright/test'
import { boot, click, expect, hold, test, tool } from './stage'

// Made by `scripts/build_demo_imagery.py` from a CC BY 4.0 sample; never committed.
const FILE = '../.cache/demo-assets/busan-new-port.tif'
const NAME = 'busan-new-port'

/** Removes what an earlier recording registered, so the list starts and ends without it. */
async function cleanUp(request: APIRequestContext) {
  const sets = (await (await request.get('/api/v1/imagery')).json()) as {
    id: string
    name: string
  }[]
  for (const set of sets.filter((item) => item.name === NAME)) {
    await request.delete(`/api/v1/imagery/${set.id}`)
  }
}

test('imagery-add', async ({ page, scene, request }) => {
  await cleanUp(request)
  await boot(page)
  await page.mouse.move(900, 620)
  await hold(page, 800)

  await scene.action()
  await tool(page, 'View')
  await click(page, page.getByRole('tab', { name: 'Imagery', exact: true }))
  await click(page, page.getByTestId('fold-imagery.add'))
  await hold(page, 800)
  // A recording has no file dialog: the file lands in the form as if it had been dropped.
  await page.getByTestId('imagery-file').setInputFiles(FILE)
  await expect(page.getByTestId('imagery-name').locator('input')).toHaveValue(NAME)
  await hold(page, 1800)
  await click(page, page.getByTestId('imagery-submit'))
  // Cut into tiles on the server, then the camera goes there and zooming in shows it.
  await expect(page.locator('[data-testid^="imagery-showing-"]')).toBeVisible({ timeout: 150_000 })
  await hold(page, 6000)
  await cleanUp(request)
})
