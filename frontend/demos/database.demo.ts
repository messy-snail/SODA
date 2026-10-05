import { boot, click, expect, hold, test, type } from './stage'

test('database', async ({ page, scene }) => {
  await boot(page)
  await page.mouse.move(900, 620)
  await hold(page, 800)

  await scene.action()
  await click(page, page.getByTestId('settings-open'))
  await click(page, page.getByTestId('settings-tab-database'))
  await expect(page.getByTestId('database-path')).toContainText('soda.db')
  await hold(page, 1500)
  // Only a probe: saving would write the settings file of whoever records this.
  await type(
    page,
    page.getByTestId('database-url').locator('input'),
    'sqlite:////tmp/soda/data/mission-a.db',
  )
  await click(page, page.getByRole('button', { name: 'Test connection' }))
  await expect(page.getByTestId('database-probe')).toBeVisible()
  await hold(page, 2500)

  await click(page, page.getByTestId('settings-tab-browse'))
  const rows = page.getByTestId('browse-rows')
  await expect(rows).toContainText('kari-daejeon')
  await hold(page, 1500)
  await click(page, page.getByTestId('browse-table'))
  await click(page, page.getByRole('option', { name: /^Element sets/ }))
  await expect(rows).toContainText('celestrak')
  await hold(page, 1000)
  await type(page, page.getByTestId('browse-search').locator('input'), 'BLUEBON')
  await expect(rows).toContainText('62688')
  await hold(page, 1200)
  await click(page, rows.locator('tbody tr').first().getByRole('button').first())
  await hold(page, 3000)
})
