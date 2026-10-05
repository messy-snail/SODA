import {
  BLUEBON,
  boot,
  click,
  expect,
  flyTo,
  hold,
  play,
  propagate,
  subpoint,
  test,
  tool,
} from './stage'

test('swath', async ({ page, scene }) => {
  await boot(page)
  await propagate(page, [{ key: BLUEBON, query: 'BLUEBON' }], '6 hours')
  await hold(page, 800)

  await scene.action()
  await tool(page, 'Swath')
  const sidebar = page.getByTestId('tool-sidebar')
  await click(page, sidebar.getByTestId('swath-draw'))
  await expect(sidebar.getByTestId('swath-stats')).toBeVisible()
  await hold(page, 2500)
  const under = await subpoint(page)
  await flyTo(page, under.lon, under.lat, 1.6e6, 2.5)
  await play(page, 12)
  await hold(page, 6000)
})
