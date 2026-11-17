/** A production build, served the way a static host serves it. */
import { BUILT, expect, markPage, open, regions, test } from './support/fixtures.js'

test.describe('prerendered pages', () => {
  test('carry their content without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto(`${BUILT}/guide/intro`)

    await expect(page.locator('h1.sb-page-title')).toHaveText('Introduction')
    await expect(page.getByText('The opening paragraph mentions zebras exactly once.')).toBeVisible()
    await expect(page.locator('.sb-callout[data-type="warning"] .sb-callout-title')).toHaveText('Careful')
    await expect(page.locator('figure.sb-code .sb-code-label')).toHaveText('example.ts')
    await expect(page.locator('figure.sb-code .sb-line-highlight')).toHaveCount(1)
    await expect(page.locator('.sb-nav-link[aria-current="page"]')).toHaveText('Introduction')
    // The link written as ./setup.md was rewritten to the page's address.
    await expect(page.getByRole('link', { name: 'the setup page' })).toHaveAttribute('href', '/guide/setup')
    await context.close()
  })

  test('hydrate with a clean console, then navigate without loading a new document', async ({ page, problems }) => {
    await open(page, `${BUILT}/guide/intro`)
    const stillThere = await markPage(page)

    await page.locator('.sb-region-sidebar').getByRole('link', { name: 'Setting up' }).click()
    await expect(page).toHaveURL(`${BUILT}/guide/setup`)
    await expect(page.locator('h1.sb-page-title')).toHaveText('Setting up')
    await expect(page).toHaveTitle('Setting up | Fixture')

    await page.goBack()
    await expect(page.locator('h1.sb-page-title')).toHaveText('Introduction')
    expect(await stillThere()).toBe(true)
    expect(problems).toEqual([])
  })

  test('follow a link to a heading on another page', async ({ page }) => {
    await open(page, `${BUILT}/guide/intro`)
    await page.getByRole('link', { name: 'its second step' }).click()
    await expect(page).toHaveURL(`${BUILT}/guide/setup#second-step`)
    await expect(page.locator('#second-step')).toBeInViewport()
    await expect(page.locator('.sb-toc a[aria-current="location"]')).toHaveText('Second step')
  })

  test('answer an unknown address with the 404 page', async ({ page }) => {
    const response = await page.goto(`${BUILT}/no/such/page`)
    expect(response?.status()).toBe(404)
    await expect(page.locator('h1.sb-page-title')).toHaveText('Page not found')
  })
})

test.describe('layouts', () => {
  test('frontmatter picks the regions a page has', async ({ page }) => {
    await open(page, `${BUILT}/`)
    await expect(page.locator('.sb-shell')).toHaveAttribute('data-layout', 'splash')
    expect(await regions(page)).toEqual(['header', 'main'])
    await expect(page.locator('h1.sb-hero-title')).toHaveText('A fixture site')

    await open(page, `${BUILT}/guide/intro`)
    await expect(page.locator('.sb-shell')).toHaveAttribute('data-layout', 'doc')
    expect(await regions(page)).toEqual(['header', 'sidebar', 'main', 'aside'])

    await open(page, `${BUILT}/api/ping`)
    await expect(page.locator('.sb-shell')).toHaveAttribute('data-layout', 'api')
    expect(await regions(page)).toEqual(['header', 'sidebar', 'main'])
    await expect(page.locator('.sb-api-method')).toHaveText('GET')
    await expect(page.locator('.sb-api-param')).toHaveText('{region}')
  })

  test('a page can switch the sidebar and the outline off', async ({ page }) => {
    await open(page, `${BUILT}/guide/hidden-sidebar`)
    expect(await regions(page)).toEqual(['header', 'main'])
    await expect(page.locator('.sb-pagination')).toHaveCount(0)
  })

  test('a layout defined in YAML is used like a built-in one', async ({ page }) => {
    await open(page, `${BUILT}/guide/wide`)
    await expect(page.locator('.sb-shell')).toHaveAttribute('data-layout', 'wide-doc')
    await expect(page.locator('.sb-shell')).toHaveAttribute('data-width', 'wide')
    expect(await regions(page)).toEqual(['header', 'sidebar', 'main'])
  })

  test('switching layout during client navigation keeps the header mounted', async ({ page }) => {
    await open(page, `${BUILT}/`)
    await page.locator('.sb-site-title').evaluate((element) => element.setAttribute('data-kept', 'yes'))
    await page.getByRole('link', { name: 'Open the guide' }).click()
    await expect(page.locator('.sb-shell')).toHaveAttribute('data-layout', 'doc')
    await expect(page.locator('.sb-site-title')).toHaveAttribute('data-kept', 'yes')
  })
})

test.describe('sidebar', () => {
  test('lists sidebar.yaml as written, then the folders it does not mention', async ({ page }) => {
    await open(page, `${BUILT}/guide/intro`)
    const sidebar = page.locator('.sb-region-sidebar')
    await expect(sidebar.locator('.sb-nav-heading')).toHaveText(['Guide', 'Play', 'API', 'Extras'])

    const extras = sidebar.locator('.sb-nav-category', { hasText: 'Extras' })
    await expect(extras.locator('.sb-nav-link')).toHaveText(['Alpha notes', 'Beta notes'])
    await expect(sidebar.locator('.sb-nav-link', { hasText: 'Setting up' }).locator('.sb-badge')).toHaveText('New')
  })

  test('opens a collapsed folder when the reader goes to a page inside it', async ({ page }) => {
    await open(page, `${BUILT}/guide/intro`)
    const folder = page.locator('details.sb-nav-folder', { hasText: 'More' })
    await expect(folder).not.toHaveAttribute('open', '')

    await folder.locator('summary').click()
    await expect(folder).toHaveAttribute('open', '')
    await folder.getByRole('link', { name: 'Wide page' }).click()
    await expect(page).toHaveURL(`${BUILT}/guide/wide`)
    await expect(page.locator('details.sb-nav-folder', { hasText: 'More' })).toHaveAttribute('open', '')
    await expect(page.locator('.sb-nav-link[aria-current="page"]')).toHaveText('Wide page')
  })

  test('offers previous and next in sidebar order', async ({ page }) => {
    await open(page, `${BUILT}/guide/setup`)
    await expect(page.locator('.sb-pagination-link[rel="prev"] .sb-pagination-title')).toHaveText('Introduction')
    await expect(page.locator('.sb-pagination-link[rel="next"] .sb-pagination-title')).toHaveText('No sidebar')
  })
})

test.describe('search', () => {
  test('finds a section by keyword and goes to it with the keyboard', async ({ page }) => {
    await open(page, `${BUILT}/guide/intro`)
    await page.keyboard.press('/')
    const dialog = page.locator('dialog.sb-search')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-store', process.env.SHABD_E2E_STORE ?? 'memory')

    const input = dialog.getByRole('combobox')
    await expect(input).toBeFocused()
    await input.fill('pelicans')
    const hits = dialog.locator('.sb-search-hit')
    await expect(hits).toHaveCount(1)
    await expect(hits.first()).toContainText('Setting up')
    await expect(hits.first()).toContainText('Second step')
    await expect(hits.first().locator('mark')).toHaveText('Pelicans')

    await input.press('Enter')
    await expect(page).toHaveURL(`${BUILT}/guide/setup#second-step`)
    await expect(dialog).toHaveCount(0)
  })

  test('matches while a word is still being typed, and says when nothing matches', async ({ page }) => {
    await open(page, `${BUILT}/`)
    await page.locator('.sb-search-button').click()
    const dialog = page.locator('dialog.sb-search')
    const input = dialog.getByRole('combobox')

    await input.fill('zeb')
    await expect(dialog.locator('.sb-search-hit').first()).toContainText('Introduction')

    await input.fill('qqzzxx')
    await expect(dialog.locator('.sb-search-empty')).toContainText('Nothing matches')
    await expect(dialog.getByRole('status')).toHaveText('Searching by keyword.')

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('moves through results with the arrow keys', async ({ page }) => {
    await open(page, `${BUILT}/`)
    await page.locator('.sb-search-button').click()
    const dialog = page.locator('dialog.sb-search')
    await dialog.getByRole('combobox').fill('step')
    const hits = dialog.locator('.sb-search-hit')
    await expect(hits.nth(1)).toBeVisible()
    await expect(hits.nth(0)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(hits.nth(1)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowUp')
    await expect(hits.nth(0)).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('components', () => {
  test('a component registered in YAML works in MDX after hydration', async ({ page }) => {
    await open(page, `${BUILT}/`)
    const counter = page.getByTestId('counter')
    await expect(counter).toHaveText('Count is 2')
    await counter.click()
    await expect(counter).toHaveText('Count is 3')
  })

  test('the theme switch changes the colour mode and remembers it', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await open(page, `${BUILT}/guide/intro`)
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'light')
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const light = await background()

    await page.locator('.sb-theme-toggle').click()
    await expect(html).toHaveAttribute('data-theme', 'dark')
    expect(await background()).not.toBe(light)

    await page.reload()
    await expect(html).toHaveAttribute('data-theme', 'dark')
  })

  test('the theme menu changes the palette in both colour modes and remembers it', async ({ page, problems }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await open(page, `${BUILT}/guide/intro`)
    const html = page.locator('html')
    const token = (name: string) =>
      page.evaluate((property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(), name)
    expect(await token('--sb-accent')).toBe('#2b36a8')

    // The colour of a keyword in the page's code block, which each preset draws in its own syntax theme.
    const keyword = page.locator('figure.sb-code span[class^="sbk-"]').first()
    const ink = () => keyword.evaluate((span) => getComputedStyle(span).color)
    const own = await ink()

    const menu = page.getByRole('button', { name: 'Choose a theme' })
    await menu.click()
    const list = page.getByRole('group', { name: 'Theme' })
    const options = list.getByRole('button')
    // The site's own palette first, then the presets that change the whole look, then the ones that only recolour.
    await expect(options.first()).toHaveText('Shabd')
    await expect(options.first()).toHaveAttribute('aria-pressed', 'true')
    await expect(list.locator('.sb-theme-menu-heading')).toHaveText(['Themes', 'Palettes'])
    await expect(options.nth(1)).toHaveText('macOS')

    await options.filter({ hasText: 'Forest' }).click()
    await expect(html).toHaveAttribute('data-palette', 'forest')
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(await token('--sb-accent')).toBe('#1f6f43')
    const forest = await ink()
    expect(forest).not.toBe(own)

    // The palette has a dark form of its own, and so does its syntax theme.
    await page.locator('.sb-theme-toggle').click()
    await expect(html).toHaveAttribute('data-theme', 'dark')
    expect(await token('--sb-accent')).toBe('#7fd69b')
    const forestDark = await ink()
    expect(forestDark).not.toBe(forest)

    // All of it comes back after a reload: the inline script applies it before the app starts.
    await page.reload()
    await expect(html).toHaveAttribute('data-palette', 'forest')
    await expect(html).toHaveAttribute('data-theme', 'dark')
    expect(await ink()).toBe(forestDark)
    await menu.click()
    await expect(options.filter({ hasText: 'Forest' })).toHaveAttribute('aria-pressed', 'true')

    // Escape closes the menu. Choosing the site's own palette forgets the choice.
    await page.keyboard.press('Escape')
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await menu.click()
    await options.first().click()
    await expect(html).not.toHaveAttribute('data-palette', /.+/)
    await expect(html).not.toHaveAttribute('data-code', /.+/)
    expect(await page.evaluate(() => localStorage.getItem('shabd-palette'))).toBeNull()
    expect(await token('--sb-accent')).toBe('#b3bbff')
    expect(problems).toEqual([])
  })

  test('the copy button puts the code on the clipboard', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions can only be granted to Chromium')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await open(page, `${BUILT}/guide/intro`)
    await page.locator('.sb-code-copy').click()
    await expect(page.locator('.sb-code-copy')).toContainText('Copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('const first = 1\nconst second = 2')
  })
})

test.describe('sandboxes', () => {
  test('code, widget and state panel show the same state', async ({ page }) => {
    await open(page, `${BUILT}/play/sandbox`)
    const sandbox = page.locator('.sb-sandbox').first()
    const button = sandbox.locator('.sb-sandbox-stage button')
    await expect(button).toHaveText('Clicked 0 times', { timeout: 15_000 })

    await button.click()
    await expect(button).toHaveText('Clicked 1 times')
    const panel = sandbox.locator('.sb-sandbox-state input')
    await expect(panel).toHaveValue('1')

    await panel.fill('7')
    await expect(button).toHaveText('Clicked 7 times')
  })

  test('editing the code keeps the state, and a mistake keeps the last working version', async ({ page }) => {
    await open(page, `${BUILT}/play/sandbox`)
    const sandbox = page.locator('.sb-sandbox').first()
    const button = sandbox.locator('.sb-sandbox-stage button')
    await expect(button).toHaveText('Clicked 0 times', { timeout: 15_000 })
    await button.click()
    await button.click()

    const editor = sandbox.locator('.sb-sandbox-editor')
    const code = await editor.inputValue()
    await editor.fill(code.replace('Clicked {count} times', 'Pressed {count} times'))
    await expect(button).toHaveText('Pressed 2 times')

    await editor.fill(code.replace('return <button', 'return <<button'))
    await expect(sandbox.locator('.sb-sandbox-problem')).toBeVisible()
    await expect(button).toHaveText('Pressed 2 times')

    await sandbox.getByRole('button', { name: 'Reset code' }).click()
    await expect(button).toHaveText('Clicked 2 times')
    await expect(sandbox.locator('.sb-sandbox-problem')).toHaveCount(0)
  })

  test('sandboxes in one group share their state', async ({ page }) => {
    await open(page, `${BUILT}/play/sandbox`)
    const meter = page.locator('.sb-sandbox', { hasText: 'Meter' }).locator('output')
    await expect(meter).toHaveText('40%', { timeout: 15_000 })
    await page.getByLabel('Level', { exact: true }).fill('73')
    await expect(meter).toHaveText('73%')
  })
})

test.describe('narrow screens', () => {
  test.use({ viewport: { width: 390, height: 800 } })

  test('the sidebar is a panel behind the menu button, and closes on navigation', async ({ page }) => {
    await open(page, `${BUILT}/guide/intro`)
    const sidebar = page.locator('.sb-region-sidebar')
    await expect(sidebar).toBeHidden()

    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(sidebar).toBeVisible()
    await sidebar.getByRole('link', { name: 'Setting up' }).click()
    await expect(page).toHaveURL(`${BUILT}/guide/setup`)
    await expect(sidebar).toBeHidden()

    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflows).toBe(false)
  })

  test('a sidebar longer than the screen scrolls inside the panel, under the header', async ({ page }) => {
    // Short enough that the test site's sidebar does not fit.
    await page.setViewportSize({ width: 390, height: 300 })
    await open(page, `${BUILT}/guide/intro`)
    const sidebar = page.locator('.sb-region-sidebar')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(sidebar).toBeVisible()

    const box = () =>
      page.evaluate(() => {
        const panel = document.querySelector('.sb-region-sidebar')!
        const { top, bottom } = panel.getBoundingClientRect()
        const header = document.querySelector('.sb-region-header')!.getBoundingClientRect().bottom
        // Where the window ends for a positioned box: above a scrollbar along the bottom, where a browser draws one.
        const floor = document.documentElement.clientHeight
        return { top: Math.round(top), bottom: Math.round(bottom), header: Math.round(header), floor, scrolls: panel.scrollHeight > panel.clientHeight + 1 }
      })
    await expect.poll(async () => (await box()).top).toBe((await box()).header)
    const { bottom, floor, scrolls } = await box()
    // The panel ends where the window ends, and what does not fit is reached by scrolling it.
    expect(bottom).toBe(floor)
    expect(floor).toBeGreaterThan(280)
    expect(scrolls).toBe(true)

    // The first link is in view, and the last one comes into view when the panel is scrolled.
    await expect(sidebar.getByRole('link', { name: 'Introduction' })).toBeInViewport()
    const last = sidebar.locator('.sb-nav-link').last()
    await expect(last).not.toBeInViewport()
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport()
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(0)
  })

  test('the panel starts where the header ends, also when a banner holds the header down', async ({ page }) => {
    await open(page, `${BUILT}/guide/hosting`)
    const header = page.locator('.sb-region-header')
    const sidebar = page.locator('.sb-region-sidebar')
    const bottomOfHeader = async () => Math.round(await header.evaluate((element) => element.getBoundingClientRect().bottom))
    const topOfPanel = () => sidebar.evaluate((element) => Math.round(element.getBoundingClientRect().top))
    const height = Math.round((await header.boundingBox())!.height)

    // At the top of the page the banner is above the header.
    expect(await bottomOfHeader()).toBeGreaterThan(height + 20)
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(sidebar).toBeVisible()
    await expect.poll(topOfPanel).toBe(await bottomOfHeader())
    // None of the panel is under the header, so its first link can be pressed.
    await sidebar.getByRole('link', { name: 'Introduction' }).click()
    await expect(page).toHaveURL(`${BUILT}/guide/intro`)

    // Scrolled past the banner, the header is at the top of the window and the panel follows it there.
    await open(page, `${BUILT}/guide/hosting`)
    // The page is a short one: give it room to scroll.
    await page.addStyleTag({ content: 'body { padding-block-end: 1200px }' })
    await page.evaluate(() => window.scrollTo(0, 400))
    await expect.poll(bottomOfHeader).toBe(height)
    // Pressed as a finger presses it. Playwright's own click first scrolls its target into view, and for a
    // button in a header that sticks to the top of the window, some engines scroll the page back for that.
    await page.locator('.sb-menu-toggle').evaluate((button: HTMLElement) => button.click())
    await expect(sidebar).toBeVisible()
    await expect.poll(topOfPanel).toBe(height)
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(400)
  })
})

test.describe('for agents', () => {
  test('llms.txt, Markdown copies and the MCP route are served', async ({ request }) => {
    const llms = await request.get(`${BUILT}/llms.txt`)
    expect(llms.ok()).toBe(true)
    const text = await llms.text()
    expect(text).toContain('# Fixture')
    expect(text).toContain('- [Introduction](https://fixture.test/guide/intro.md): The first page of the guide.')
    expect(text.indexOf('## Guide')).toBeLessThan(text.indexOf('## Extras'))

    const markdown = await request.get(`${BUILT}/guide/setup.md`)
    expect(await markdown.text()).toMatch(/^# Setting up\n/)

    const mcp = await request.post(`${BUILT}/mcp`, {
      headers: { accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_docs', arguments: { query: 'pelicans' } } },
    })
    const body = (await mcp.json()) as { result: { content: { text: string }[] } }
    expect(body.result.content[0]?.text).toContain('path: /guide/setup#second-step')
  })
})
