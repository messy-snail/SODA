import { boot, click, hold, test, tool } from './stage'

// Sample imagery from the `samples` submodule; both sets are CC BY 4.0.
const OPTICAL = 'satellogic-busan-new-port'
const SAR = 'umbra-busan-port'

test('imagery', async ({ page, scene }) => {
  await boot(page)
  await page.mouse.move(800, 600)
  await hold(page, 800)

  await scene.action()
  await tool(page, 'View')
  await click(page, page.getByRole('tab', { name: 'Imagery', exact: true }))
  await hold(page, 1000)
  await click(page, page.getByTestId(`imagery-fly-${OPTICAL}`))
  await hold(page, 5000)
  await click(page, page.getByTestId(`imagery-fly-${SAR}`))
  await hold(page, 5000)
})
