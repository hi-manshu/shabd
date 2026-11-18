/** A production build, served the way a static host serves it. */
import type { Page } from '@playwright/test'
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
    // The last one is not a folder of the site: its pages are made from an OpenAPI description (openapi.spec.ts).
    await expect(sidebar.locator('.sb-nav-heading')).toHaveText(['Guide', 'Play', 'API', 'Extras', 'Fixture store'])

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

  test('forgives a misspelt word, and marks the word it was taken for', async ({ page }) => {
    await open(page, `${BUILT}/guide/intro`)
    await page.locator('.sb-search-button').click()
    const dialog = page.locator('dialog.sb-search')
    const input = dialog.getByRole('combobox')
    const hits = dialog.locator('.sb-search-hit')

    // Two letters swapped. No section has the word as typed.
    await input.fill('pelicnas')
    await expect(hits).toHaveCount(1)
    await expect(hits.first()).toContainText('Second step')
    await expect(hits.first().locator('mark')).toHaveText('Pelicans')
    // Whichever store the site was built with is the one that forgave it.
    await expect(dialog).toHaveAttribute('data-store', process.env.SHABD_E2E_STORE ?? 'memory')

    // A word of three letters is too short to guess at.
    await input.fill('zbe')
    await expect(dialog.locator('.sb-search-empty')).toContainText('Nothing matches')

    await input.fill('pelicnas')
    await expect(hits).toHaveCount(1)
    await input.press('Enter')
    await expect(page).toHaveURL(`${BUILT}/guide/setup#second-step`)
    await expect
      .poll(() => page.evaluate(() => [...(CSS.highlights.get('sb-search') ?? [])].map((range) => String(range))))
      .toEqual(['Pelicans'])
  })

  test('finds words in scripts written without spaces, and marks them', async ({ page }) => {
    await open(page, `${BUILT}/guide/intro`)
    await page.locator('.sb-search-button').click()
    const dialog = page.locator('dialog.sb-search')
    const input = dialog.getByRole('combobox')
    const hits = dialog.locator('.sb-search-hit')
    /** What is marked in the first result's excerpt, run together: a word can be marked as two. */
    const markedInExcerpt = async () => (await hits.first().locator('.sb-search-hit-snippet mark').allTextContents()).join('')

    // [what is typed, the heading of the section it is in]
    const cases = [
      ['浏览器', '中文'],
      ['主题配置', '中文'],
      ['ブラウザー', '日本語'],
      ['設定', '日本語'],
      // Playwright's Firefox cuts these three otherwise than Node does: サイドバー as one word where Node has
      // サイド and バー, ทำ and งาน where Node has ทำงาน, ติดตั้ง where Node has ติด and ตั้ง. On the SQLite
      // store the index was cut by Node when the site was built, and Firefox has to find them all the same.
      ['サイドバー', '日本語'],
      ['ทำงาน', 'ภาษาไทย'],
      ['ติดตั้ง', 'ภาษาไทย'],
      // Firefox leaves this whole in its sentence and cuts it in two, เบราว์ and เซอร์, when it is typed alone.
      ['เบราว์เซอร์', 'ภาษาไทย'],
    ] as const
    for (const [query, heading] of cases) {
      await input.fill(query)
      await expect(hits.first().locator('.sb-search-hit-where'), query).toContainText(`Other scripts${heading}`)
      await expect.poll(markedInExcerpt, query).toBe(query)
    }
    await expect(dialog).toHaveAttribute('data-store', process.env.SHABD_E2E_STORE ?? 'memory')

    // A word still being typed is found from its first letter.
    await input.fill('浏')
    await expect(hits.first().locator('.sb-search-hit-where')).toContainText('中文')
    await expect.poll(markedInExcerpt).toBe('浏览')

    // Going to a result marks the word on the page, under its heading.
    await input.fill('サイドバー')
    await expect(hits.first().locator('.sb-search-hit-where')).toContainText('日本語')
    await input.press('Enter')
    await expect(page).toHaveURL(`${BUILT}/guide/scripts#${encodeURIComponent('日本語')}`)
    await expect(page.locator('h1.sb-page-title')).toHaveText('Other scripts')
    await expect
      .poll(() => page.evaluate(() => [...(CSS.highlights.get('sb-search') ?? [])].map((range) => String(range)).join('')))
      .toBe('サイドバー')
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

  /** The words marked on the page, as written there. */
  const marked = (page: Page) =>
    page.evaluate(() => [...(CSS.highlights?.get('sb-search') ?? [])].map((range) => String(range)))

  /** Search for the word that one passage of the long section holds, and take the only result. */
  const findWombats = async (page: Page, choose: 'Enter' | 'click') => {
    await page.locator('.sb-search-button').click()
    const dialog = page.locator('dialog.sb-search')
    await dialog.getByRole('combobox').fill('wombats')
    const hits = dialog.locator('.sb-search-hit')
    await expect(hits).toHaveCount(1)
    await expect(hits.first()).toContainText("The keeper's log")
    if (choose === 'Enter') await dialog.getByRole('combobox').press('Enter')
    else await hits.first().click()
    await expect(dialog).toHaveCount(0)
  }

  test('a result leads to the passage that matched, with the words of the query marked', async ({ page, problems }) => {
    await open(page, `${BUILT}/guide/intro`)
    const address = `${BUILT}/guide/long-read#the-keepers-log`
    const heading = page.locator('#the-keepers-log')
    const sentence = page.getByText('three wombats were found asleep in the coal store')

    // The section is indexed as five passages, and the word is in the fourth: some forty lines under the heading.
    await findWombats(page, 'Enter')
    // The address is the section's, and says nothing of the passage or the query.
    await expect(page).toHaveURL(address)
    await expect.poll(() => marked(page)).toEqual(['wombats'])
    await expect(sentence).toBeInViewport()
    await expect(heading).not.toBeInViewport()

    // The mark is drawn in the theme's highlight colour, and the word it is on can be seen.
    const mark = await page.evaluate(() => {
      const [range] = CSS.highlights.get('sb-search')!
      const box = (range as Range).getBoundingClientRect()
      const probe = document.body.appendChild(document.createElement('i'))
      probe.style.backgroundColor = 'var(--sb-highlight-soft)'
      const token = getComputedStyle(probe).backgroundColor
      probe.remove()
      return {
        colour: getComputedStyle(document.querySelector('.sb-content')!, '::highlight(sb-search)').backgroundColor,
        token,
        visible: box.top >= 0 && box.bottom <= window.innerHeight && box.width > 0,
      }
    })
    expect(mark.colour).toBe(mark.token)
    expect(mark.colour).not.toBe('rgba(0, 0, 0, 0)')
    expect(mark.visible).toBe(true)

    // Escape clears the marks for good: a reload shows the section from its heading, as its address says.
    await page.keyboard.press('Escape')
    expect(await marked(page)).toEqual([])
    await page.reload()
    await expect(page.locator('html[data-shabd="ready"]')).toBeAttached()
    await expect(heading).toBeInViewport()
    expect(await marked(page)).toEqual([])

    // A click on a result does what Enter does. Left alone, the marks are still there after a reload.
    await findWombats(page, 'click')
    await expect(page).toHaveURL(address)
    await expect.poll(() => marked(page)).toEqual(['wombats'])
    await page.reload()
    await expect(page.locator('html[data-shabd="ready"]')).toBeAttached()
    await expect.poll(() => marked(page)).toEqual(['wombats'])
    await expect(sentence).toBeInViewport()
    await expect(heading).not.toBeInViewport()

    // They go with the next navigation, and coming back does not bring them again.
    await page.locator('.sb-region-sidebar').getByRole('link', { name: 'Introduction' }).click()
    await expect(page).toHaveURL(`${BUILT}/guide/intro`)
    expect(await marked(page)).toEqual([])
    await page.goBack()
    await expect(page).toHaveURL(address)
    await expect(page.locator('h1.sb-page-title')).toHaveText('A long read')
    expect(await marked(page)).toEqual([])
    expect(problems).toEqual([])
  })

  test('a browser without the Custom Highlight API goes to the passage and marks nothing', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as { Highlight?: unknown }).Highlight
    })
    await open(page, `${BUILT}/guide/intro`)
    expect(await page.evaluate(() => typeof Highlight)).toBe('undefined')

    await findWombats(page, 'Enter')
    await expect(page).toHaveURL(`${BUILT}/guide/long-read#the-keepers-log`)
    await expect(page.getByText('three wombats were found asleep in the coal store')).toBeInViewport()
    await expect(page.locator('#the-keepers-log')).not.toBeInViewport()
    expect(await marked(page)).toEqual([])
  })

  test('where the passage is taller than the window, the first marked word is brought into view', async ({ page }) => {
    // The word is some seven lines into its passage. In a window this short, the start of the passage alone would hide it.
    await page.setViewportSize({ width: 1280, height: 230 })
    await open(page, `${BUILT}/guide/intro`)
    await findWombats(page, 'Enter')
    await expect.poll(() => marked(page)).toEqual(['wombats'])

    const seen = await page.evaluate(() => {
      const [range] = CSS.highlights.get('sb-search')!
      const box = (range as Range).getBoundingClientRect()
      const header = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)
      return box.top >= header && box.bottom <= window.innerHeight
    })
    expect(seen).toBe(true)
  })

  test('a result in a short section leads to its heading, with the words marked under it', async ({ page }) => {
    await open(page, `${BUILT}/guide/intro`)
    await page.locator('.sb-search-button').click()
    const dialog = page.locator('dialog.sb-search')
    await dialog.getByRole('combobox').fill('pelicans')
    await expect(dialog.locator('.sb-search-hit')).toHaveCount(1)
    await dialog.getByRole('combobox').press('Enter')

    await expect(page).toHaveURL(`${BUILT}/guide/setup#second-step`)
    await expect(page.locator('#second-step')).toBeInViewport()
    await expect.poll(() => marked(page)).toEqual(['Pelicans'])

    // A link to another heading of the same page is a navigation too: the marks go.
    await page.locator('.sb-toc').getByRole('link', { name: 'First step' }).click()
    await expect(page).toHaveURL(`${BUILT}/guide/setup#first-step`)
    await expect.poll(() => marked(page)).toEqual([])
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

  test('a page offers itself as Markdown: to copy, to open and to hand to an assistant', async ({ page, context, browserName }) => {
    await open(page, `${BUILT}/guide/setup`)
    const actions = page.locator('.sb-page-actions')
    await expect(actions.getByRole('link', { name: 'View as Markdown' })).toHaveAttribute('href', '/guide/setup.md')
    // An assistant is given the address the site is deployed at, since that is where it can fetch the page.
    const claude = (await actions.getByRole('link', { name: 'Open in Claude' }).getAttribute('href')) ?? ''
    expect(claude).toMatch(/^https:\/\/claude\.ai\/new\?q=/)
    expect(decodeURIComponent(claude)).toContain('Read https://fixture.test/guide/setup.md so that')

    if (browserName === 'chromium') {
      // Clipboard permissions can only be granted to Chromium.
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await actions.getByRole('button', { name: 'Copy page' }).click()
      await expect(actions.getByRole('button')).toContainText('Copied')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^# Setting up\n\nThis page has no frontmatter/)
    }

    // The home page is a splash page: its layout has no such row.
    await open(page, `${BUILT}/`)
    await expect(page.locator('.sb-page-actions')).toHaveCount(0)
  })
})

test.describe('redirects', () => {
  test('an address that has moved leads to the new one, with and without JavaScript', async ({ page, browser }) => {
    await page.goto(`${BUILT}/guide/start`)
    await expect(page).toHaveURL(`${BUILT}/guide/intro`)
    await expect(page.locator('h1.sb-page-title')).toHaveText('Introduction')

    await page.goto(`${BUILT}/old-setup`)
    await expect(page).toHaveURL(`${BUILT}/guide/setup#second-step`)
    await expect(page.locator('#second-step')).toBeInViewport()

    const context = await browser.newContext({ javaScriptEnabled: false })
    const plain = await context.newPage()
    await plain.goto(`${BUILT}/guide/start`)
    await expect(plain).toHaveURL(`${BUILT}/guide/intro`)
    await context.close()
  })

  test('the page at the old address says where it went and is kept out of search engines', async ({ request }) => {
    const html = await (await request.get(`${BUILT}/guide/start`)).text()
    expect(html).toContain('<link rel="canonical" href="https://fixture.test/guide/intro">')
    expect(html).toContain('<meta name="robots" content="noindex">')
    // Only pages are listed for search engines and for agents.
    expect(await (await request.get(`${BUILT}/sitemap.xml`)).text()).not.toContain('/guide/start')
    expect(await (await request.get(`${BUILT}/llms.txt`)).text()).not.toContain('/guide/start')
  })
})

test.describe('the document', () => {
  test('carries the tags from site.head', async ({ request }) => {
    const html = await (await request.get(`${BUILT}/guide/intro`)).text()
    expect(html).toContain('<meta name="fixture-head" content="written by site.head">')
  })
})

test.describe('the feed', () => {
  test('lists the pages that have a day, and every page says where it is', async ({ page, request }) => {
    const feed = await request.get(`${BUILT}/rss.xml`)
    expect(feed.ok()).toBe(true)
    const xml = await feed.text()
    expect(xml).toContain('<link>https://fixture.test/extras/alpha</link>')
    expect(xml).toContain('<pubDate>Tue, 03 Feb 2026 00:00:00 GMT</pubDate>')
    // A page with no day has no place in a feed.
    expect(xml).not.toContain('/guide/intro')

    const html = await (await request.get(`${BUILT}/guide/intro`)).text()
    expect(html).toContain('<link rel="alternate" type="application/rss+xml" title="Fixture" href="/rss.xml">')

    // The browser's own XML parser takes it as it is.
    await page.goto(`${BUILT}/guide/intro`)
    const parsed = await page.evaluate(async () => {
      const document = new DOMParser().parseFromString(await (await fetch('/rss.xml')).text(), 'application/xml')
      return {
        error: document.querySelector('parsererror')?.textContent ?? null,
        root: document.documentElement.nodeName,
        items: document.querySelectorAll('channel > item').length,
      }
    })
    expect(parsed).toEqual({ error: null, root: 'rss', items: 1 })
  })
})

test.describe('on paper', () => {
  test('a printed page is the page alone, in the light colours, with nothing left to scroll', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await open(page, `${BUILT}/guide/hosting`)
    const ink = () => page.evaluate(() => getComputedStyle(document.body).color)
    const lightInk = await ink()

    // The reader has the dark mode on, and the page has a banner, a header, a sidebar and an outline.
    await page.locator('.sb-theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await ink()).not.toBe(lightInk)
    for (const region of ['banner', 'header', 'sidebar', 'aside']) await expect(page.locator(`.sb-region-${region}`)).toBeVisible()

    await page.emulateMedia({ media: 'print' })
    for (const region of ['banner', 'header', 'sidebar', 'aside']) await expect(page.locator(`.sb-region-${region}`)).toBeHidden()
    await expect(page.locator('h1.sb-page-title')).toBeVisible()
    await expect(page.locator('.sb-code-copy').first()).toBeHidden()
    await expect(page.locator('.sb-pagination')).toBeHidden()
    // Paper is white whatever the device is set to.
    expect(await ink()).toBe(lightInk)

    // A long line of code wraps instead of running off the sheet.
    const code = page.locator('figure.sb-code pre').first()
    expect(await code.evaluate((pre) => pre.scrollWidth <= pre.clientWidth)).toBe(true)
    // Where a link leads is printed after it.
    const after = await page
      .getByRole('link', { name: 'this list' })
      .evaluate((link) => getComputedStyle(link, '::after').content)
    expect(after).toContain('https://example.com/hosts')
  })
})

test.describe('for search engines', () => {
  test('robots.txt names the sitemap, and a page that says noindex is left out of it', async ({ request }) => {
    const text = (path: string) => request.get(`${BUILT}${path}`).then((response) => response.text())
    expect(await text('/robots.txt')).toBe('User-agent: *\nAllow: /\n\nSitemap: https://fixture.test/sitemap.xml\n')

    const sitemap = await text('/sitemap.xml')
    expect(sitemap).toContain('<loc>https://fixture.test/extras/alpha</loc>')
    expect(sitemap).not.toContain('/extras/beta')

    const noindex = '<meta name="robots" content="noindex">'
    expect(await text('/extras/beta')).toContain(noindex)
    expect(await text('/extras/alpha')).not.toContain(noindex)
    // The page that answers for an address that does not exist is not one to list.
    expect(await text('/no/such/page')).toContain(noindex)
  })
})
