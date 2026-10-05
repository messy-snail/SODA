import {
  BLUEBON,
  KOMPSAT_3A,
  boot,
  click,
  expect,
  hold,
  play,
  propagate,
  test,
  tool,
} from './stage'

test('passes', async ({ page, scene }) => {
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
  await tool(page, 'Pass prediction')
  const sidebar = page.getByTestId('tool-sidebar')
  await click(page, sidebar.getByRole('button', { name: 'Predict passes' }))
  const rows = sidebar.locator('.pass-row')
  await expect(rows.first()).toBeVisible()
  await hold(page, 1800)
  await click(page, rows.first())
  await play(page, 40)
  await hold(page, 5000)
  await play(page, 0)
  await click(page, rows.first().getByTestId('pass-detail'))
  const detail = page.getByTestId('pass-detail-dialog')
  await hold(page, 2200)
  await click(page, detail.getByRole('button', { name: 'Range rate' }))
  await hold(page, 2500)
})
