import { BLUEBON, boot, click, hold, play, propagate, test } from './stage'

test('view', async ({ page, scene }) => {
  await boot(page, { lighting: true })
  await propagate(page, [{ key: BLUEBON, query: 'BLUEBON' }], '6 hours')
  await hold(page, 800)

  await scene.action()
  await click(page, page.getByTestId('scene-mode'))
  await hold(page, 3000)
  await play(page, 400)
  await hold(page, 6000)
  await play(page, 0)
  await click(page, page.getByTestId('scene-mode'))
  await hold(page, 3500)
})
