import {
  BLUEBON,
  KOMPSAT_3A,
  boot,
  click,
  clickAt,
  expect,
  hold,
  propagate,
  test,
  tool,
} from './stage'

test('imaging', async ({ page, scene }) => {
  await boot(page)
  await propagate(
    page,
    [
      { key: BLUEBON, query: 'BLUEBON' },
      { key: KOMPSAT_3A, query: 'KOMPSAT-3A' },
    ],
    '1 day',
  )
  await hold(page, 800)

  await scene.action()
  await tool(page, 'Imaging plan')
  const panel = page.getByTestId('mission-access')
  await click(page, panel.getByTestId('aoi-add-box'))
  const box = (await page.locator('.cesium-widget canvas').boundingBox())!
  await clickAt(page, box.x + box.width * 0.43, box.y + box.height * 0.36)
  await clickAt(page, box.x + box.width * 0.6, box.y + box.height * 0.6)
  await expect(panel).toContainText('Imaging targets (1/20)')
  await hold(page, 800)
  await click(page, panel.getByTestId('access-compute'))
  const rows = panel.getByTestId('access-row')
  await expect(rows.first()).toBeVisible()
  await hold(page, 2000)
  await click(page, rows.first())
  await hold(page, 2500)
  if ((await rows.count()) > 1) await click(page, rows.nth(1))
  await hold(page, 3000)
})
