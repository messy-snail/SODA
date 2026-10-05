import { BLUEBON, boot, click, expect, hold, play, propagate, test, tool } from './stage'

test('tmtc', async ({ page, scene }) => {
  // The server keeps one session for every tab; start from none.
  await page.request.delete('/api/v1/tmtc/session')
  await boot(page)
  await propagate(page, [{ key: BLUEBON, query: 'BLUEBON' }], '1 day')
  await hold(page, 800)

  await scene.action()
  await tool(page, 'TC/TM link')
  const panel = page.getByTestId('mission-tmtc')
  await click(page, panel.getByTestId('tmtc-start'))
  await expect(panel.getByTestId('tmtc-link')).toBeVisible()
  await hold(page, 1200)
  await click(page, panel.getByTestId('tmtc-send'))
  await hold(page, 1200)
  await click(page, panel.getByTestId('tmtc-next-aos'))
  await expect(panel.getByTestId('tmtc-link')).toContainText('Open')
  await play(page, 20)
  await hold(page, 6000)
  await play(page, 0)
  await panel.getByTestId('tmtc-stop').click()
})
