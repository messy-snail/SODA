import { BLUEBON, KOMPSAT_3A, boot, flyTo, foldSidebar, hold, play, propagate, test } from './stage'

test('hero', async ({ page, scene }) => {
  await boot(page)
  await propagate(
    page,
    [
      { key: BLUEBON, query: 'BLUEBON' },
      { key: KOMPSAT_3A, query: 'KOMPSAT-3A' },
    ],
    '6 hours',
  )
  await foldSidebar(page)
  await page.mouse.move(1100, 690)
  await flyTo(page, 127.8, 30, 1.9e7, 0)
  await hold(page, 2500)

  await scene.action()
  await play(page, 300)
  await hold(page, 12000)
})
