/** The components a page is written with, in a production build. */
import { BUILT, expect, open, test } from './support/fixtures.js'

const PAGE = `${BUILT}/play/writing`

test.describe('steps, file tree and accordion', () => {
  test('an ordered list inside Steps is still a list, with its numbers drawn beside the steps', async ({ page }) => {
    await open(page, PAGE)
    const steps = page.locator('.sb-steps > ol > li')
    await expect(steps).toHaveCount(3)
    // The numbers are the stylesheet's: a counter, in a box before each step.
    const numbers = await steps.evaluateAll((items) => items.map((item) => getComputedStyle(item, '::before').content))
    expect(numbers).toEqual(['counter(sb-step)', 'counter(sb-step)', 'counter(sb-step)'])
    expect(await steps.first().evaluate((item) => getComputedStyle(item).listStyleType)).toBe('none')
    await expect(steps.nth(1)).toContainText('A second paragraph of the same step.')
  })

  test('a file tree tells folders from files by the shape of the list', async ({ page }) => {
    await open(page, PAGE)
    const icon = (text: string) =>
      page
        .locator('.sb-file-tree li', { hasText: text })
        .first()
        .evaluate((item) => getComputedStyle(item, '::before').getPropertyValue('--sb-tree-icon'))
    const [file, folder] = [await icon('shabd.config.yaml'), await icon('content/')]
    expect(file).toContain('data:image/svg+xml')
    expect(folder).toContain('data:image/svg+xml')
    expect(folder).not.toBe(file)
    // Bold marks an entry, and italics are a note beside it.
    await expect(page.locator('.sb-file-tree strong')).toHaveText('guide.md')
    await expect(page.locator('.sb-file-tree em')).toHaveText('the page this is about')
  })

  test('an accordion is closed until it is asked for, and opens without JavaScript', async ({ page, browser }) => {
    await open(page, PAGE)
    const accordion = page.locator('details.sb-accordion')
    const body = accordion.getByText('Kangaroos are mentioned here')
    await expect(body).toBeHidden()
    await accordion.locator('summary').click()
    await expect(body).toBeVisible()

    const context = await browser.newContext({ javaScriptEnabled: false })
    const plain = await context.newPage()
    await plain.goto(PAGE)
    await plain.locator('details.sb-accordion summary').click()
    await expect(plain.getByText('Kangaroos are mentioned here')).toBeVisible()
    await context.close()
  })
})

test.describe('tabs that follow each other', () => {
  test('choosing a tab chooses it in every set with the same key, and the browser keeps the choice', async ({ page, problems }) => {
    await open(page, PAGE)
    const sets = page.locator('.sb-tabs')
    const shown = (index: number) => sets.nth(index).locator('.sb-tab-panel:not([hidden])')
    await expect(shown(0)).toHaveText('Use npm here.')
    await expect(shown(1)).toHaveText('And npm there.')

    await sets.nth(0).getByRole('tab', { name: 'pnpm' }).click()
    await expect(shown(0)).toHaveText('Use pnpm here.')
    await expect(shown(1)).toHaveText('And pnpm there.')
    // A set without a key is its own, even with tabs of the same names.
    await expect(shown(2)).toHaveText('A set that follows nobody.')

    // A tab that only one set has changes that set alone.
    await sets.nth(1).getByRole('tab', { name: 'yarn' }).click()
    await expect(shown(1)).toHaveText('And yarn there.')
    await expect(shown(0)).toHaveText('Use pnpm here.')

    await sets.nth(1).getByRole('tab', { name: 'pnpm' }).click()
    await page.reload()
    await expect(page.locator('html[data-shabd="ready"]')).toBeAttached()
    await expect(shown(0)).toHaveText('Use pnpm here.')
    await expect(shown(1)).toHaveText('And pnpm there.')
    // Nothing about remembering the choice may disturb hydration.
    expect(problems).toEqual([])
  })

  test('every tab is printed, each under its label', async ({ page }) => {
    await open(page, PAGE)
    await page.emulateMedia({ media: 'print' })
    const first = page.locator('.sb-tabs').first()
    await expect(first.locator('.sb-tab-list')).toBeHidden()
    await expect(first.getByText('Use npm here.')).toBeVisible()
    await expect(first.getByText('Use pnpm here.')).toBeVisible()
    const label = await first.locator('.sb-tab-panel').nth(1).evaluate((panel) => getComputedStyle(panel, '::before').content)
    expect(label).toBe('"pnpm"')
  })
})

test.describe('diagrams', () => {
  const DIAGRAM = `${BUILT}/play/diagram`

  test('a mermaid fence is drawn in the site\'s colours, and drawn again when they change', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await open(page, DIAGRAM)
    const diagram = page.locator('.sb-mermaid').first()
    const drawing = diagram.locator('svg')
    await expect(drawing).toBeVisible({ timeout: 20_000 })
    await expect(drawing).toContainText('Markdown pages')
    await expect(drawing).toContainText('shabd build')
    // Once drawn, the source is gone from the page.
    await expect(diagram.locator('.sb-mermaid-source')).toHaveCount(0)

    // A node is filled with the theme's surface colour, whichever mode that is.
    const surface = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sb-surface').trim().toLowerCase())
    const nodeFill = () =>
      diagram
        .locator('svg .node rect, svg .node polygon')
        .first()
        .evaluate((shape) => getComputedStyle(shape).fill)
    const asRgb = (hex: string) => `rgb(${[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(', ')})`
    const light = await surface()
    expect(await nodeFill()).toBe(asRgb(light))

    await page.locator('.sb-theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const dark = await surface()
    expect(dark).not.toBe(light)
    await expect.poll(nodeFill).toBe(asRgb(dark))
  })

  test('a diagram that cannot be read keeps its source on the page and says what is wrong', async ({ page }) => {
    await open(page, DIAGRAM)
    const broken = page.locator('.sb-mermaid').nth(1)
    await expect(broken.locator('.sb-mermaid-problem')).toBeVisible({ timeout: 20_000 })
    await expect(broken.locator('.sb-mermaid-source')).toContainText('this is not --> a diagram')
    await expect(broken.locator('svg')).toHaveCount(0)
    // Mermaid leaves a picture of its error at the end of the page. It is cleared away.
    await expect(page.locator('body > [id^="dsb-mermaid"], body > svg')).toHaveCount(0)
  })

  test('without JavaScript the page shows the source of the diagram', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto(DIAGRAM)
    await expect(page.locator('.sb-mermaid-source').first()).toContainText('flowchart LR')
    await context.close()
  })
})

test.describe('code that changed', () => {
  test('added and removed lines carry a sign and a bar, and nothing behind their text', async ({ page }) => {
    await open(page, PAGE)
    const line = (kind: 'ins' | 'del') => page.locator(`figure.sb-code .sb-line-${kind}`)
    await expect(line('del')).toHaveText('const answer = 41')
    await expect(line('ins')).toHaveText('const answer = 42')
    const sign = (kind: 'ins' | 'del') => line(kind).evaluate((element) => getComputedStyle(element, '::after').content)
    expect(await sign('ins')).toBe('"+"')
    expect(await sign('del')).toBe('"−"')
    // Token colours are made readable against the code background. A line that changed must not put another one behind them.
    expect(await line('ins').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  })
})
