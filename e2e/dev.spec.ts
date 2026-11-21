/** The dev server: files change on disk and the page on screen follows, without loading again. */
import type { APIRequestContext, APIResponse, Locator, Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, symlink } from 'node:fs/promises'
import { contrastOn, parseColor, type Rgba } from '../packages/shabd/src/shared/color.js'
import { PRESET_NAMES } from '../packages/shabd/src/shared/presets.js'
import { DEV, expect, markPage, open, regions, test, type SiteFiles } from './support/fixtures.js'

test.describe.configure({ mode: 'serial' })

const cssVariable = (page: Page, name: string) =>
  page.evaluate((variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim(), name)

test.describe('hot updates', () => {
  test('a saved page edit appears in place', async ({ page, site }) => {
    await open(page, `${DEV}/guide/intro`)
    const stillThere = await markPage(page)

    await site.edit('content/guide/intro.md', (text) => text.replace('zebras exactly once', 'zebras and giraffes'))
    await expect(page.getByText('The opening paragraph mentions zebras and giraffes.')).toBeVisible()
    expect(await stillThere()).toBe(true)
  })

  test('a page that carries the marks of a search result still updates in place', async ({ page, site, problems }) => {
    await open(page, `${DEV}/guide/intro`)
    await page.locator('.sb-search-button').click()
    const dialog = page.locator('dialog.sb-search')
    await dialog.getByRole('combobox').fill('wombats')
    await expect(dialog.locator('.sb-search-hit')).toHaveCount(1)
    await dialog.getByRole('combobox').press('Enter')
    await expect(page).toHaveURL(`${DEV}/guide/long-read#the-keepers-log`)
    const marked = () => page.evaluate(() => [...(CSS.highlights.get('sb-search') ?? [])].map((range) => String(range)))
    await expect.poll(marked).toEqual(['wombats'])
    const stillThere = await markPage(page)

    // The marks are ranges over the page's text, not elements in it: React has nothing of theirs to reconcile.
    await site.edit('content/guide/long-read.md', (text) => text.replace('He was right twice.', 'He was right three times.'))
    await expect(page.getByText('He was right three times.')).toBeVisible()
    expect(await stillThere()).toBe(true)
    // A hot update renders the body again. The text that was marked is gone, and the marks go with it.
    expect(await marked()).toEqual([])
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(500)
    expect(problems).toEqual([])
  })

  test('frontmatter edits change the layout of the page on screen', async ({ page, site }) => {
    await open(page, `${DEV}/guide/intro`)
    const stillThere = await markPage(page)
    expect(await regions(page)).toEqual(['header', 'sidebar', 'main', 'aside'])

    await site.edit('content/guide/intro.md', (text) => text.replace('badges: [Beta]', 'badges: [Beta]\nsidebar: false'))
    await expect.poll(() => regions(page)).toEqual(['header', 'main', 'aside'])

    await site.edit('content/guide/intro.md', (text) => text.replace('sidebar: false', 'layout: splash'))
    await expect(page.locator('.sb-shell')).toHaveAttribute('data-layout', 'splash')
    await expect.poll(() => regions(page)).toEqual(['header', 'main'])
    expect(await stillThere()).toBe(true)
  })

  test('a title edit reaches the page, the sidebar and the tab', async ({ page, site }) => {
    await open(page, `${DEV}/guide/intro`)
    await site.edit('content/guide/intro.md', (text) => text.replace('title: Introduction', 'title: Welcome aboard'))
    await expect(page.locator('h1.sb-page-title')).toHaveText('Welcome aboard')
    await expect(page.locator('.sb-nav-link[aria-current="page"]')).toHaveText('Welcome aboard')
    await expect(page).toHaveTitle('Welcome aboard | Fixture')
  })

  test('theme tokens and the sidebar file hot-swap', async ({ page, site }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await open(page, `${DEV}/guide/intro`)
    const stillThere = await markPage(page)
    expect(await cssVariable(page, '--sb-highlight')).toBe('#f6b40e')
    // A token on a highlighted line of code. It is coloured to be readable on that line's tint.
    const keyword = page.locator('.sb-code .sb-line-highlight span', { hasText: /^const$/ })
    const colour = () => keyword.evaluate((element) => getComputedStyle(element).color)
    const before = await colour()

    await site.edit('shabd.config.yaml', (text) => text.replace('light: "#f6b40e"', 'light: "#00aa55"'))
    await expect.poll(() => cssVariable(page, '--sb-highlight')).toBe('#00aa55')
    // The tint is darker now, so the token has to be too: the page's code is compiled again, in place.
    await expect.poll(colour).not.toBe(before)

    await site.edit('sidebar.yaml', (text) => text.replace('- category: Guide', '- category: Handbook'))
    await expect(page.locator('.sb-nav-heading').first()).toHaveText('Handbook')
    expect(await stillThere()).toBe(true)
  })

  test('a new page joins the routes and its generated group, and leaves when deleted', async ({ page, site }) => {
    await open(page, `${DEV}/guide/intro`)
    const stillThere = await markPage(page)
    const extras = page.locator('.sb-nav-category', { hasText: 'Extras' })
    await expect(extras.locator('.sb-nav-link')).toHaveText(['Alpha notes', 'Beta notes'])

    await site.write('content/extras/gamma.md', '---\ntitle: Gamma notes\n---\n\nAdded while the server was running.\n')
    await expect(extras.locator('.sb-nav-link')).toHaveText(['Alpha notes', 'Beta notes', 'Gamma notes'])
    await extras.getByRole('link', { name: 'Gamma notes' }).click()
    await expect(page.getByText('Added while the server was running.')).toBeVisible()
    expect(await stillThere()).toBe(true)

    await site.remove('content/extras/gamma.md')
    await expect(extras.locator('.sb-nav-link')).toHaveText(['Alpha notes', 'Beta notes'])
    await expect(page.locator('h1.sb-page-title')).toHaveText('Page not found')
  })

  test('a page renamed on disk moves in the routes and the navigation, and the page on screen is not loaded again', async ({ page, site }) => {
    await open(page, `${DEV}/guide/intro`)
    const stillThere = await markPage(page)
    const extras = page.locator('.sb-nav-category', { hasText: 'Extras' })
    const beta = await site.read('content/extras/beta.md')
    const renamed = beta.replace('Beta notes', 'Gamma notes')

    // A rename is two changes at once: a file that is new and a file that is gone. Some tools make the new
    // one first, some remove the old one first. Each order went wrong in its own way, roughly one time in ten
    // on the machine this was written on. So each is done a few times here, which catches a return of either
    // most of the time and not every time.
    for (let round = 1; round <= 3; round++) {
      await site.write('content/extras/gamma.md', renamed)
      await site.remove('content/extras/beta.md')
      await expect(extras.locator('.sb-nav-link')).toHaveText(['Alpha notes', 'Gamma notes'])
      await extras.getByRole('link', { name: 'Gamma notes' }).click()
      await expect(page).toHaveURL(`${DEV}/extras/gamma`)

      await site.remove('content/extras/gamma.md')
      await site.write('content/extras/beta.md', beta)
      await expect(extras.locator('.sb-nav-link')).toHaveText(['Alpha notes', 'Beta notes'])
      await extras.getByRole('link', { name: 'Beta notes' }).click()
      await expect(page).toHaveURL(`${DEV}/extras/beta`)
      expect(await stillThere(), `after rename ${round} and back`).toBe(true)
    }
  })

  test('a mistake in the config is shown over the page, and clears when it is fixed', async ({ page, site }) => {
    await open(page, `${DEV}/guide/intro`)

    await site.edit('shabd.config.yaml', (text) => text.replace('description: A site', 'descripton: A site'))
    const overlay = page.locator('vite-error-overlay')
    await expect(overlay).toBeAttached()
    await expect(overlay.locator('.message-body')).toContainText('Unknown key "descripton". Did you mean "description"?')
    await expect(overlay.locator('.file')).toContainText('shabd.config.yaml:4:3')

    // Vite reloads the page when the first update it receives follows an error, so no in-place check here.
    // A reload takes its time on a busy machine: allow for it.
    await site.edit('shabd.config.yaml', (text) => text.replace('descripton: A site', 'description: A site'))
    await expect(overlay).not.toBeAttached({ timeout: 15_000 })
    await expect(page.locator('h1.sb-page-title')).toHaveText('Introduction')
  })

  test('a page that stops compiling shows why in place, and recovers in place', async ({ page, site }) => {
    await open(page, `${DEV}/guide/intro`)
    const stillThere = await markPage(page)
    const error = page.locator('.sb-page-error')

    // Invalid frontmatter. The page keeps the title, layout and sidebar entry it had.
    await site.edit('content/guide/intro.md', (text) => text.replace('badges: [Beta]', 'layout: docs'))
    await expect(error).toContainText('Layout "docs" does not exist. Did you mean "doc"?')
    await expect(error).toContainText('content/guide/intro.md:4:9')
    await expect(page.locator('h1.sb-page-title')).toHaveText('Introduction')
    await expect(page.locator('.sb-nav-link[aria-current="page"]')).toHaveText('Introduction')
    expect(await regions(page)).toEqual(['header', 'sidebar', 'main'])

    await site.edit('content/guide/intro.md', (text) => text.replace('layout: docs', 'badges: [Beta]'))
    await expect(error).toHaveCount(0)
    await expect(page.getByText('The opening paragraph mentions zebras exactly once.')).toBeVisible()
    expect(await stillThere()).toBe(true)

    // A syntax error in MDX is handled the same way.
    await page.goto(`${DEV}/play/sandbox`)
    await expect(page.locator('html[data-shabd="ready"]')).toBeAttached()
    const stillThereToo = await markPage(page)
    await site.edit('content/play/sandbox.mdx', (text) => `${text}\n<Unclosed>\n`)
    await expect(error).toContainText('Expected a closing tag for `<Unclosed>`')
    await site.edit('content/play/sandbox.mdx', (text) => text.replace('\n<Unclosed>\n', ''))
    await expect(error).toHaveCount(0)
    await expect(page.locator('.sb-sandbox').first()).toBeVisible()
    expect(await stillThereToo()).toBe(true)
  })

  test('opening a page that is already broken shows the error inside the site, not a blank page', async ({ page, site }) => {
    await site.edit('content/guide/intro.md', (text) => text.replace('badges: [Beta]', 'badges: Beta'))
    await open(page, `${DEV}/guide/intro`)
    await expect(page.locator('.sb-page-error')).toContainText('badges')
    // Navigation still works from a broken page.
    await page.locator('.sb-region-sidebar').getByRole('link', { name: 'Setting up' }).click()
    await expect(page.locator('h1.sb-page-title')).toHaveText('Setting up')
  })
})

test.describe('studio', () => {
  /** The Studio's editor, found the way a screen reader finds it: a text field, by its name. */
  const editorOf = (page: Page): Locator => page.getByRole('textbox', { name: /^Markdown source of / })

  const openStudio = async (page: Page, path: string) => {
    await open(page, `${DEV}${path}`)
    await page.getByRole('button', { name: 'Edit page' }).click()
    const editor = editorOf(page)
    // It cannot be typed into until the file has been read.
    await expect(editor).toBeEditable()
    return editor
  }

  /**
   * What the editor shows, line for line. CodeMirror draws only the lines near the ones in view; the
   * pages these tests edit are short enough to be drawn whole.
   */
  const textOf = (editor: Locator): Promise<string> =>
    editor.locator('.cm-line').allTextContents().then((lines) => lines.join('\n'))

  /** Put the cursor at the end of the line that holds `text`. */
  const cursorAfter = async (editor: Locator, text: string) => {
    await editor.locator('.cm-line', { hasText: text }).click()
    await editor.press('End')
  }

  /**
   * Wait until the file holds exactly what the editor shows. A test that types and stops sooner leaves a
   * save on its way. It lands after the test's files have been put back, and the tests that follow find
   * the page as this one left it.
   */
  const written = (editor: Locator, site: SiteFiles, file: string) =>
    expect.poll(async () => (await site.read(file)) === (await textOf(editor))).toBe(true)

  test('typing saves to the file and updates the page beside it', async ({ page, site }) => {
    await site.track('content/guide/setup.md')
    const editor = await openStudio(page, '/guide/setup')
    const stillThere = await markPage(page)
    await expect(page.locator('.sb-studio-file strong')).toHaveText('content/guide/setup.md')
    expect(await textOf(editor)).toBe(await site.read('content/guide/setup.md'))

    // Key by key, as a person types.
    await cursorAfter(editor, 'Install the thing.')
    await page.keyboard.type(' Then the other thing.')
    await expect(page.locator('.sb-content')).toContainText('Install the thing. Then the other thing.')
    await expect(page.locator('.sb-studio-footer')).toContainText(/Saved\. The page updated \d+ ms later\./)
    expect(await site.read('content/guide/setup.md')).toContain('Install the thing. Then the other thing.')

    // And all at once, as a paste over everything does.
    await editor.fill((await textOf(editor)).replace('Then the other thing.', 'Then another.'))
    await expect(page.locator('.sb-content')).toContainText('Install the thing. Then another.')
    await expect.poll(() => site.read('content/guide/setup.md')).toContain('Install the thing. Then another.')
    expect(await stillThere()).toBe(true)
  })

  test('follows the file when it changes on disk and nothing is unsaved', async ({ page, site }) => {
    const editor = await openStudio(page, '/guide/setup')
    await cursorAfter(editor, '## Second step')

    await site.edit('content/guide/setup.md', (text) => text.replace('Install the thing.', 'Changed in another editor.'))
    await expect(editor).toContainText('Changed in another editor.')
    expect(await textOf(editor)).toBe(await site.read('content/guide/setup.md'))

    // The cursor is still where it was: only the line that changed was touched.
    await page.keyboard.type(' of two')
    await expect.poll(() => site.read('content/guide/setup.md')).toContain('Changed in another editor.\n\n## Second step of two\n')
  })

  test('undo takes back what was typed and not what came from the file, and a new page has nothing to undo', async ({ page, site }) => {
    await site.track('content/guide/setup.md')
    await site.track('content/guide/intro.md')
    const editor = await openStudio(page, '/guide/setup')
    await cursorAfter(editor, 'Install the thing.')
    await page.keyboard.type(' Typed here.')
    await expect.poll(() => site.read('content/guide/setup.md')).toContain('Install the thing. Typed here.')
    // The Studio has seen its own save come back as a page. The next change to the file is someone else's.
    await expect(page.locator('.sb-studio-footer')).toContainText('The page updated')

    // Something else changes another line of the file, and the editor follows.
    await site.edit('content/guide/setup.md', (text) => text.replace('Run the thing.', 'Run the thing twice.'))
    await expect(editor).toContainText('Run the thing twice.')

    await editor.press('ControlOrMeta+z')
    await expect(editor).not.toContainText('Typed here.')
    await expect(editor).toContainText('Run the thing twice.')
    await expect.poll(() => site.read('content/guide/setup.md')).toContain('Install the thing.\n\n## Second step\n\nRun the thing twice.')

    // Another page is another document: what was typed in the first cannot be undone into it.
    await page.locator('.sb-region-sidebar').getByRole('link', { name: 'Introduction' }).click()
    await expect(page.locator('.sb-studio-file strong')).toHaveText('content/guide/intro.md')
    const intro = await site.read('content/guide/intro.md')
    await expect.poll(() => textOf(editor)).toBe(intro)
    await expect(editor).toBeEditable()
    await cursorAfter(editor, 'zebras')
    await editor.press('ControlOrMeta+z')
    await editor.press('ControlOrMeta+Shift+z')
    await page.keyboard.type('!')
    await expect.poll(() => site.read('content/guide/intro.md')).toBe(intro.replace('exactly once.', 'exactly once.!'))
  })

  test('a file with Windows line endings keeps them when it is edited', async ({ page, site }) => {
    await site.edit('content/guide/setup.md', (text) => text.replace(/\n/g, '\r\n'))
    const windows = await site.read('content/guide/setup.md')
    const editor = await openStudio(page, '/guide/setup')

    await cursorAfter(editor, 'Install the thing.')
    await page.keyboard.type(' And the rest.')
    // One sentence was added. Every line still ends as it did.
    await expect
      .poll(() => site.read('content/guide/setup.md'))
      .toBe(windows.replace('Install the thing.', 'Install the thing. And the rest.'))
  })

  test('asks which version to keep when the file and the draft both changed', async ({ page, site }) => {
    const editor = await openStudio(page, '/guide/setup')
    const original = await textOf(editor)

    // Type, and before the pause that triggers a save is over, change the file underneath.
    await editor.fill(original.replace('Install the thing.', 'My draft.'))
    await site.write('content/guide/setup.md', original.replace('Install the thing.', 'Their change.'))

    const footer = page.locator('.sb-studio-footer')
    await expect(footer).toContainText('This file was changed outside the Studio.')
    expect(await site.read('content/guide/setup.md')).toContain('Their change.')

    await footer.getByRole('button', { name: 'Load the file from disk' }).click()
    await expect.poll(() => textOf(editor)).toBe(original.replace('Install the thing.', 'Their change.'))

    // The other way round: keep the draft, and it is written over the file.
    await editor.fill(original.replace('Install the thing.', 'My second draft.'))
    await site.write('content/guide/setup.md', original.replace('Install the thing.', 'Their second change.'))
    await expect(footer).toContainText('This file was changed outside the Studio.')
    await footer.getByRole('button', { name: 'Keep my version' }).click()
    await expect.poll(() => site.read('content/guide/setup.md')).toContain('My second draft.')
  })

  test('the editor can be reached and left with the keyboard alone', async ({ page, site }) => {
    await site.track('content/guide/setup.md')
    const editor = await openStudio(page, '/guide/setup')
    // The way out is part of what a screen reader says about the field, and is on screen while the field has focus.
    const hint = 'Tab indents. To move on by keyboard, press Esc, then Tab.'
    await expect(editor).toHaveAccessibleDescription(hint)
    await expect(page.getByText(hint)).toBeHidden()

    // From the control before it, which is the last of the buttons above it.
    await page.getByRole('button', { name: 'Delete', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(editor).toBeFocused()
    await expect(page.getByText(hint)).toBeVisible()

    // Tab indents the line the cursor is on and Shift+Tab takes the indent back. Neither moves on.
    await page.keyboard.press('Tab')
    await expect.poll(() => textOf(editor)).toMatch(/^ {2}# Setting up\n/)
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => textOf(editor)).toMatch(/^# Setting up\n/)
    await expect(editor).toBeFocused()

    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab')
    await expect(editor).not.toBeFocused()
    await expect(page.getByText(hint)).toBeHidden()
    await written(editor, site, 'content/guide/setup.md')
  })

  test('Ctrl or ⌘ + S saves without waiting for a pause in typing', async ({ page, site }) => {
    await site.track('content/guide/setup.md')
    const editor = await openStudio(page, '/guide/setup')
    await cursorAfter(editor, 'Install the thing.')

    // Note when the key goes down, when the file is sent, and whether the browser was kept from saving the page itself.
    await page.evaluate(() => {
      const seen = { key: 0, sent: 0, prevented: false }
      Object.assign(window, { __save: seen })
      const isSave = (event: KeyboardEvent) => event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)
      window.addEventListener('keydown', (event) => void (isSave(event) && Object.assign(seen, { key: performance.now(), sent: 0 })), true)
      window.addEventListener('keydown', (event) => void (isSave(event) && (seen.prevented = event.defaultPrevented)))
      const send = window.fetch
      window.fetch = (input, init) => {
        if (init?.method === 'PUT' && seen.key && !seen.sent) seen.sent = performance.now()
        return send(input, init)
      }
    })

    // A save follows a quarter of a second without typing. One sent within a tenth of a second of the key did
    // not wait for that. On a machine too busy to press the key that soon after the letter, the pause gets
    // there first and the key finds nothing left to save: then it is tried again.
    await expect(async () => {
      await page.keyboard.type('!')
      await page.keyboard.press('ControlOrMeta+s')
      const seen = await page.evaluate(() => (window as unknown as { __save: { key: number; sent: number; prevented: boolean } }).__save)
      expect(seen.prevented).toBe(true)
      expect(seen.sent).toBeGreaterThan(0)
      expect(seen.sent - seen.key).toBeLessThan(100)
    }).toPass()
    await written(editor, site, 'content/guide/setup.md')
    expect(await site.read('content/guide/setup.md')).toMatch(/Install the thing\.!+\n/)
  })

  test('the editor is drawn in the palette\'s own colours, readable in every preset and both modes', async ({ page, site }) => {
    await site.track('content/guide/intro.md')
    const editor = await openStudio(page, '/guide/intro')
    // A little of everything the editor colours: frontmatter, Markdown, and code in a fence.
    await editor.fill(
      [
        '---',
        'title: Colours',
        'badges: [New, "Quoted"]',
        '---',
        '',
        '# A heading with `code` and a [link](https://example.com "A title")',
        '',
        '> [!NOTE] A callout, **strong** and *slanted*',
        '',
        '- [ ] a task <!-- a comment -->',
        '',
        '```tsx',
        '// A comment',
        'export default function Example({ count = 2 }: { count: number }) {',
        '  const label: string = `Clicked ${count} times`',
        '  return <button className="primary" onClick={() => alert(\'hi\')}>{label}</button>',
        '}',
        '```',
        '',
      ].join('\n'),
    )
    await written(editor, site, 'content/guide/intro.md')
    // Wait for the fence to be read as TSX: a keyword in the palette's accent.
    await expect(editor.locator('.cm-line', { hasText: 'export default' }).locator('span', { hasText: /^export$/ })).toBeVisible()

    // Put every preset on the page in turn, in both modes, and read what the editor is drawn in.
    const drawn = await page.evaluate((presets) => {
      const root = document.documentElement
      const before = { palette: root.dataset.palette, theme: root.dataset.theme }
      const probe = document.body.appendChild(document.createElement('span'))
      const token = (name: string) => {
        probe.style.color = `var(--sb-${name})`
        return getComputedStyle(probe).color
      }
      /** The colour of the nearest thing with a colour of its own behind an element. */
      const behind = (element: Element | null): string => {
        for (let at = element; at; at = at.parentElement) {
          const colour = getComputedStyle(at).backgroundColor
          if (colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') return colour
        }
        return 'none'
      }
      const content = document.querySelector('.sb-studio .cm-content')!
      const result = []
      for (const preset of presets) {
        for (const mode of ['light', 'dark']) {
          root.dataset.palette = preset
          root.dataset.theme = mode
          const pairs = new Set<string>()
          const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
          while (walker.nextNode()) {
            const text = walker.currentNode
            if (text.textContent?.trim()) pairs.add(`${getComputedStyle(text.parentElement!).color} on ${behind(text.parentElement)}`)
          }
          const names = ['text', 'muted', 'accent', 'note', 'tip', 'success', 'caution', 'danger', 'background', 'surface']
          result.push({ preset, mode, pairs: [...pairs], tokens: Object.fromEntries(names.map((name) => [name, token(name)])) })
        }
      }
      probe.remove()
      if (before.palette === undefined) delete root.dataset.palette
      else root.dataset.palette = before.palette
      root.dataset.theme = before.theme
      return result
    }, PRESET_NAMES)

    expect(drawn).toHaveLength(PRESET_NAMES.length * 2)
    const floors: Record<string, number> = { text: 7, muted: 4.5, accent: 4.5, note: 4.5, tip: 4.5, success: 4.5, caution: 4.5, danger: 4.5 }
    const misses: string[] = []
    for (const { preset, mode, pairs, tokens } of drawn) {
      const used = new Set<string>()
      for (const pair of pairs) {
        const [ink = '', under = ''] = pair.split(' on ')
        // Two of a palette's colours may be the same one: then the stricter floor applies.
        const names = Object.keys(floors).filter((name) => tokens[name] === ink)
        for (const name of names) used.add(name)
        if (names.length === 0) misses.push(`${preset} ${mode}: ${ink} is not one of the palette's colours for text`)
        if (under !== tokens.surface) misses.push(`${preset} ${mode}: text on ${under}, which is not the surface colour ${tokens.surface}`)
        const floor = Math.max(...names.map((name) => floors[name]!))
        const ratio = contrastOn(parseColor(ink) as Rgba, parseColor(under) as Rgba)
        if (ratio < floor) misses.push(`${preset} ${mode}: ${names.join('/')} ${ink} on ${under} is ${ratio.toFixed(2)}, needs ${floor}`)
      }
      // Seven of the eight: nothing in the sample is invalid, which is all that `danger` is for.
      const unused = Object.keys(floors).filter((name) => name !== 'danger' && !used.has(name))
      if (unused.length > 0) misses.push(`${preset} ${mode}: nothing in the sample is drawn in ${unused.join(', ')}`)
    }
    expect(misses).toEqual([])

    // The switch in the header reaches the editor like the rest of the page.
    const ink = () => editor.evaluate((element) => getComputedStyle(element).color)
    const before = await ink()
    await page.getByRole('button', { name: 'Switch colour theme' }).click()
    await expect.poll(ink).not.toBe(before)
    expect(await ink()).toBe(await page.evaluate(() => getComputedStyle(document.body).color))
  })

  test('makes a page from the Studio and goes to it', async ({ page, site }) => {
    await site.track('content/extras/epsilon.md')
    const editor = await openStudio(page, '/extras/alpha')
    const stillThere = await markPage(page)

    await page.getByRole('button', { name: 'New page' }).click()
    const name = page.getByLabel('File for the new page, in content/')
    // It starts in the folder of the page on screen, with the cursor in it.
    await expect(name).toHaveValue('extras/')
    await expect(name).toBeFocused()
    const hint = page.locator('.sb-studio-hint')
    const create = page.getByRole('button', { name: 'Create page' })

    // What cannot be a page is said while it is typed, and cannot be sent.
    for (const [typed, problem] of [
      ['extras/_hidden', '"_hidden.md" starts with "_", and a file or folder that does is not a page.'],
      ['../outside', 'A path cannot contain "." or "..". Name the folder the page is in.'],
      ['extras/alpha', 'extras/alpha.md already has the address /extras/alpha.'],
      ['extras/Alpha.mdx', 'extras/alpha.md already has the address /extras/alpha.'],
    ] as const) {
      await name.fill(typed)
      await expect(hint).toHaveText(problem)
      await expect(create).toBeDisabled()
    }

    await name.fill('extras/epsilon')
    await expect(hint).toHaveText('Its address will be /extras/epsilon.')
    await create.click()
    await expect(page).toHaveURL(`${DEV}/extras/epsilon`)
    await expect(page.locator('h1.sb-page-title')).toHaveText('Epsilon')
    await expect(page.locator('.sb-nav-category', { hasText: 'Extras' }).locator('.sb-nav-link')).toHaveText(['Alpha notes', 'Beta notes', 'Epsilon'])
    await expect(page.locator('.sb-studio-file strong')).toHaveText('content/extras/epsilon.md')
    const outcome = page.locator('.sb-studio-outcome')
    await expect(outcome).toContainText('Made content/extras/epsilon.md. Its address is /extras/epsilon.')
    await expect(outcome).toContainText('shabd check reports nothing it did not report before.')
    expect(await site.read('content/extras/epsilon.md')).toBe('---\ntitle: Epsilon\n---\n\n')
    expect(await stillThere()).toBe(true)

    // The new page is in the editor, to be written.
    await expect.poll(() => textOf(editor)).toBe('---\ntitle: Epsilon\n---\n\n')
    await expect(editor).toBeEditable()
    await editor.locator('.cm-line').last().click()
    await page.keyboard.type('The fifth letter.')
    await expect(page.locator('.sb-content')).toContainText('The fifth letter.')
    await written(editor, site, 'content/extras/epsilon.md')
  })

  test('renames a page, follows it to its new address and says what shabd check makes of the move', async ({ page, request, site }) => {
    for (const file of ['content/guide/setup.md', 'content/guide/install.md', 'shabd.config.yaml']) await site.track(file)
    const config = await site.read('shabd.config.yaml')
    const editor = await openStudio(page, '/guide/setup')
    const stillThere = await markPage(page)

    // Something typed and not saved yet goes with the page.
    await cursorAfter(editor, 'Install the thing.')
    await page.keyboard.type(' Typed just before the move.')
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    const name = page.getByLabel('New name for guide/setup.md, in content/')
    await expect(name).toHaveValue('guide/setup.md')
    await name.fill('guide/install')
    await expect(page.locator('.sb-studio-hint')).toHaveText(
      'Its address changes from /guide/setup to /guide/install. Links to /guide/setup in other pages are not changed.',
    )
    await name.press('Enter')

    await expect(page).toHaveURL(`${DEV}/guide/install`)
    await expect(page.locator('h1.sb-page-title')).toHaveText('Setting up')
    await expect(page.locator('.sb-studio-file strong')).toHaveText('content/guide/install.md')
    expect(existsSync(site.path('content/guide/setup.md'))).toBe(false)
    expect(await site.read('content/guide/install.md')).toContain('Install the thing. Typed just before the move.')
    expect((await request.get(`${DEV}/guide/setup`)).status()).toBe(404)
    expect(await stillThere()).toBe(true)

    // Other pages are not rewritten. What the move broke is listed, in the words `shabd check` uses.
    const outcome = page.locator('.sb-studio-outcome')
    await expect(outcome).toContainText(
      'content/guide/setup.md is now content/guide/install.md. Its address changed from /guide/setup to /guide/install.',
    )
    const found = outcome.locator('.sb-studio-found li')
    const stillWrong = [
      'warning sidebar.yaml:4 "guide/setup" does not match any page in the content directory',
      'note sidebar.yaml /guide/install is published but not in the sidebar. Add it, or set `sidebar: { exclude: true }` in its frontmatter.',
    ]
    // Each is on the line it is written on, wherever that line is in the fixture's files today.
    const lineOf = async (file: string, text: string) => (await site.read(file)).split('\n').findIndex((line) => line.includes(text)) + 1
    const link = await lineOf('content/guide/intro.md', '(./setup.md)')
    const redirect = await lineOf('shabd.config.yaml', '/old-setup:')
    expect(link).toBeGreaterThan(0)
    expect(redirect).toBeGreaterThan(0)
    await expect(found).toHaveText([
      stillWrong[0]!,
      // Two links on one line of the page: to the page, and to a heading of it.
      `error content/guide/intro.md:${link} Broken link: no page at /guide/setup`,
      `error content/guide/intro.md:${link} Broken link: no page at /guide/setup`,
      `error shabd.config.yaml:${redirect} Redirect from /old-setup leads to /guide/setup, where there is no page`,
      stillWrong[1]!,
    ])
    expect(await site.read('content/guide/intro.md')).toContain('[the setup page](./setup.md)')

    // A redirect is one line more in the config, and nothing else in it changes.
    await page.getByRole('button', { name: 'Add a redirect from /guide/setup' }).click()
    await expect(outcome).toContainText('Readers of /guide/setup are now sent on to /guide/install: the redirect is in shabd.config.yaml.')
    expect(await site.read('shabd.config.yaml')).toBe(config.replace('#second-step\n', '#second-step\n  /guide/setup: /guide/install\n'))
    const sent = await request.get(`${DEV}/guide/setup`, { maxRedirects: 0 })
    expect([sent.status(), sent.headers().location]).toEqual([302, '/guide/install'])
    // The links work again, by way of the redirect, which `shabd check` still finds worth a word.
    await expect(found).toHaveText([
      stillWrong[0]!,
      `warning content/guide/intro.md:${link} Link to /guide/setup, which has moved to /guide/install. Link there instead.`,
      `warning content/guide/intro.md:${link} Link to /guide/setup, which has moved to /guide/install. Link there instead.`,
      stillWrong[1]!,
    ])
    await expect(page.getByRole('button', { name: /^Add a redirect/ })).toHaveCount(0)
  })

  test('does not offer a redirect that it could not add without rewriting the config', async ({ page, site }) => {
    for (const file of ['content/extras/alpha.md', 'content/extras/first.md']) await site.track(file)
    // The same redirects as before, written between braces on one line.
    await site.edit('shabd.config.yaml', (text) =>
      text.replace(
        'redirects:\n  /guide/start: /guide/intro\n  /old-setup: /guide/setup#second-step\n',
        'redirects: { /guide/start: /guide/intro, /old-setup: "/guide/setup#second-step" }\n',
      ),
    )
    const config = await site.read('shabd.config.yaml')
    await openStudio(page, '/extras/alpha')

    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await page.getByLabel('New name for extras/alpha.md, in content/').fill('extras/first')
    await page.getByRole('button', { name: 'Rename page' }).click()
    await expect(page).toHaveURL(`${DEV}/extras/first`)

    const outcome = page.locator('.sb-studio-outcome')
    await expect(outcome).toContainText(
      'A redirect from /extras/alpha was not offered. The redirects in shabd.config.yaml are written between braces, and a line cannot be added to those without rewriting them. ' +
        'To add it yourself, put this under redirects: in shabd.config.yaml: /extras/alpha: /extras/first',
    )
    await expect(page.getByRole('button', { name: /^Add a redirect/ })).toHaveCount(0)
    expect(await site.read('shabd.config.yaml')).toBe(config)
  })

  test('deletes a page after asking, and goes to the page beside it', async ({ page, request, site }) => {
    await site.track('content/extras/beta.md')
    await openStudio(page, '/extras/beta')
    const stillThere = await markPage(page)

    // It asks first, and Esc is an answer.
    const remove = page.getByRole('button', { name: 'Delete', exact: true })
    await remove.click()
    const question = page.getByRole('form', { name: 'Delete this page' })
    await expect(question).toContainText('Delete content/extras/beta.md? The file is removed from disk.')
    await expect(question.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(question).toHaveCount(0)
    await expect(remove).toBeFocused()
    expect(existsSync(site.path('content/extras/beta.md'))).toBe(true)

    await remove.click()
    await question.getByRole('button', { name: 'Delete page' }).click()
    await expect(page).toHaveURL(`${DEV}/extras/alpha`)
    await expect(page.locator('h1.sb-page-title')).toHaveText('Alpha notes')
    await expect(page.locator('.sb-studio-file strong')).toHaveText('content/extras/alpha.md')
    await expect(page.locator('.sb-studio-outcome')).toContainText('Deleted content/extras/beta.md.')
    expect(existsSync(site.path('content/extras/beta.md'))).toBe(false)
    expect((await request.get(`${DEV}/extras/beta`)).status()).toBe(404)
    await expect(page.locator('.sb-nav-category', { hasText: 'Extras' }).locator('.sb-nav-link')).toHaveText(['Alpha notes'])
    expect(await stillThere()).toBe(true)
  })

  /**
   * The real folder picker is a system dialog that a test cannot click. A folder in the browser's private file
   * system stands in for the one it would return: it hands out the same kind of handles.
   */
  const pickPrivateFolder = (page: Page) =>
    page.addInitScript(() => {
      const contentFolder = async () => {
        const root = await navigator.storage.getDirectory()
        return root.getDirectoryHandle('content', { create: true })
      }
      Object.defineProperty(window, 'showDirectoryPicker', { value: contentFolder, configurable: true })
    })

  /** The text of a file in that folder, by its path from the folder. Null where there is no such file. */
  const inFolder = (page: Page, file: string): Promise<string | null> =>
    page.evaluate(async (path) => {
      const parts = path.split('/')
      const name = parts.pop()!
      try {
        let folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('content')
        for (const part of parts) folder = await folder.getDirectoryHandle(part)
        return await (await (await folder.getFileHandle(name)).getFile()).text()
      } catch {
        return null
      }
    }, file)

  const putInFolder = (page: Page, file: string, text: string): Promise<void> =>
    page.evaluate(
      async ([path, contents]) => {
        const parts = path.split('/')
        const name = parts.pop()!
        let folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('content', { create: true })
        for (const part of parts) folder = await folder.getDirectoryHandle(part, { create: true })
        const writable = await (await folder.getFileHandle(name, { create: true })).createWritable()
        await writable.write(contents)
        await writable.close()
      },
      [file, text] as const,
    )

  test('saves through a connected folder with the File System Access API', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the File System Access API only exists in Chromium browsers')
    await pickPrivateFolder(page)
    const readStored = () => inFolder(page, 'guide/setup.md')
    const writeStored = (text: string) => putInFolder(page, 'guide/setup.md', text)

    const editor = await openStudio(page, '/guide/setup')
    const label = page.locator('.sb-studio-file span')
    await expect(label).toHaveText('Saving through the dev server')
    await writeStored('# Setting up\n\nThe copy in the folder.\n')

    await page.getByRole('button', { name: 'Connect a folder' }).click()
    await expect(label).toHaveText('Writing to the “content” folder on this device')
    await expect.poll(() => textOf(editor)).toBe('# Setting up\n\nThe copy in the folder.\n')

    await editor.fill('# Setting up\n\nWritten by the browser.\n')
    await expect(page.locator('.sb-studio-footer')).toContainText('Saved.')
    expect(await readStored()).toBe('# Setting up\n\nWritten by the browser.\n')

    // A change made behind the Studio's back is noticed before it is overwritten.
    await page.waitForTimeout(20)
    await writeStored('# Setting up\n\nChanged by something else.\n')
    await editor.fill('# Setting up\n\nA draft that would overwrite it.\n')
    await expect(page.locator('.sb-studio-footer')).toContainText('This file was changed outside the Studio.')
    expect(await readStored()).toBe('# Setting up\n\nChanged by something else.\n')

    // The folder is remembered: after a reload the Studio goes straight back to it.
    await page.reload()
    await page.getByRole('button', { name: 'Edit page' }).click()
    await expect(label).toHaveText('Writing to the “content” folder on this device')
    await expect.poll(() => textOf(editorOf(page))).toBe('# Setting up\n\nChanged by something else.\n')
  })

  test('makes, renames and deletes pages in a connected folder', async ({ page, browserName, site }) => {
    test.skip(browserName !== 'chromium', 'the File System Access API only exists in Chromium browsers')
    for (const file of ['content/extras/eta.md', 'content/extras/theta.md']) await site.track(file)
    await pickPrivateFolder(page)
    const starter = '---\ntitle: Eta\n---\n\n'

    const editor = await openStudio(page, '/extras/alpha')
    await putInFolder(page, 'extras/alpha.md', await site.read('content/extras/alpha.md'))
    await putInFolder(page, 'extras/taken.md', 'In the folder, and not a page the site knows of.\n')
    await page.getByRole('button', { name: 'Connect a folder' }).click()
    await expect(page.locator('.sb-studio-file span')).toHaveText('Writing to the “content” folder on this device')

    // The browser writes the new file itself, and will not write over one that is there. Here only it can
    // know that one is: the site has no page of that name to object to.
    await page.getByRole('button', { name: 'New page' }).click()
    const name = page.getByLabel('File for the new page, in content/')
    await name.fill('extras/taken')
    await name.press('Enter')
    await expect(page.locator('.sb-studio-problem')).toHaveText('There is already a file at extras/taken.md.')
    expect(await inFolder(page, 'extras/taken.md')).toBe('In the folder, and not a page the site knows of.\n')

    await name.fill('extras/eta')
    await name.press('Enter')
    await expect.poll(() => inFolder(page, 'extras/eta.md')).toBe(starter)
    // The stand-in folder is not the one the dev server reads. A real one is, so the test does what a real one
    // does by being that folder: the same file turns up on disk, and the dev server notices it.
    await site.write('content/extras/eta.md', starter)
    await expect(page).toHaveURL(`${DEV}/extras/eta`)
    await expect(page.locator('.sb-studio-file strong')).toHaveText('content/extras/eta.md')
    await expect.poll(() => textOf(editor)).toBe(starter)
    await expect(page.locator('.sb-studio-outcome')).toContainText('Made content/extras/eta.md. Its address is /extras/eta.')

    // Renamed: the text is at the new name, and nothing is left at the old one.
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await page.getByLabel('New name for extras/eta.md, in content/').fill('extras/theta')
    await page.getByRole('button', { name: 'Rename page' }).click()
    await expect.poll(() => inFolder(page, 'extras/theta.md')).toBe(starter)
    await expect.poll(() => inFolder(page, 'extras/eta.md')).toBeNull()
    await site.write('content/extras/theta.md', starter)
    await site.remove('content/extras/eta.md')
    await expect(page).toHaveURL(`${DEV}/extras/theta`)
    await expect(page.locator('.sb-studio-file strong')).toHaveText('content/extras/theta.md')
    await expect(page.locator('.sb-studio-outcome')).toContainText('Its address changed from /extras/eta to /extras/theta.')
    await expect(editor).toBeEditable()

    // Deleted.
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('button', { name: 'Delete page' }).click()
    await expect.poll(() => inFolder(page, 'extras/theta.md')).toBeNull()
    await site.remove('content/extras/theta.md')
    await expect(page).toHaveURL(`${DEV}/extras/beta`)
    await expect(page.locator('.sb-studio-outcome')).toContainText('Deleted content/extras/theta.md.')
    expect(await inFolder(page, 'extras/alpha.md')).toBe(await site.read('content/extras/alpha.md'))
  })

  test('a draft typed in one tab shows in another, which keeps its cursor', async ({ page, context, site }) => {
    await site.track('content/guide/setup.md')
    const first = await openStudio(page, '/guide/setup')
    const otherTab = await context.newPage()
    const second = await openStudio(otherTab, '/guide/setup')
    await cursorAfter(second, '## Second step')

    await cursorAfter(first, 'Install the thing.')
    await page.keyboard.type(' Typed in the first tab.')
    await expect(second).toContainText('Install the thing. Typed in the first tab.')

    // The draft replaced the whole text of the second tab. Its cursor is still at the end of the heading.
    await otherTab.keyboard.type(' of two')
    await expect(first).toContainText('## Second step of two')
    await expect
      .poll(() => site.read('content/guide/setup.md'))
      .toContain('Install the thing. Typed in the first tab.\n\n## Second step of two\n')
    await otherTab.close()
  })

  test('two editors connect peer to peer and share a draft', async ({ page, browser, browserName, site }) => {
    // On GitHub's Linux machines, Playwright's Firefox and WebKit connect two pages only some of the time: the
    // same commit passed and failed there. Chromium connects every time, and all three do on macOS.
    test.skip(process.platform === 'linux' && browserName !== 'chromium', 'peer connections between two pages are not dependable in this browser on Linux')
    await site.track('content/guide/setup.md')
    const host = page
    // Not every browser build can open a peer connection on every machine: WebKit as built for Linux
    // cannot. Where two connections on one page cannot reach each other, two editors cannot either.
    await host.goto(`${DEV}/guide/setup`)
    const canConnect = await host.evaluate(async () => {
      if (typeof RTCPeerConnection !== 'function') return false
      const [first, second] = [new RTCPeerConnection(), new RTCPeerConnection()]
      try {
        first.onicecandidate = (event) => void (event.candidate && second.addIceCandidate(event.candidate))
        second.onicecandidate = (event) => void (event.candidate && first.addIceCandidate(event.candidate))
        const channel = first.createDataChannel('probe')
        const opened = new Promise<boolean>((resolve) => {
          channel.onopen = () => resolve(true)
          setTimeout(() => resolve(false), 8000)
        })
        await first.setLocalDescription(await first.createOffer())
        await second.setRemoteDescription(first.localDescription!)
        await second.setLocalDescription(await second.createAnswer())
        await first.setRemoteDescription(second.localDescription!)
        return await opened
      } catch {
        return false
      } finally {
        first.close()
        second.close()
      }
    })
    test.skip(!canConnect, 'this browser cannot open a peer connection on this machine')
    const guestContext = await browser.newContext()
    const guest = await guestContext.newPage()

    const hostEditor = await openStudio(host, '/guide/setup')
    const guestEditor = await openStudio(guest, '/guide/setup')
    const hostPanel = host.locator('.sb-studio-peers')
    const guestPanel = guest.locator('.sb-studio-peers')
    await hostPanel.locator('summary').click()
    await guestPanel.locator('summary').click()

    // Signalling by hand: an invite one way, a reply the other.
    await hostPanel.getByRole('button', { name: 'Create an invite' }).click()
    const invite = hostPanel.getByLabel('Send this invite to the other person')
    await expect(invite).toHaveValue(/.{100,}/, { timeout: 10_000 })

    await guestPanel.getByLabel('Invite', { exact: true }).fill(await invite.inputValue())
    await guestPanel.getByRole('button', { name: 'Join' }).click()
    const reply = guestPanel.getByLabel('Send this reply back')
    await expect(reply).toHaveValue(/.{100,}/, { timeout: 10_000 })

    await hostPanel.getByLabel('Paste their reply').fill(await reply.inputValue())
    await hostPanel.getByRole('button', { name: 'Connect' }).click()
    await expect(hostPanel).toContainText('You are connected', { timeout: 15_000 })
    await expect(guestPanel).toContainText('You are connected', { timeout: 15_000 })

    // A draft typed on one side appears on the other, in both directions.
    const original = await textOf(hostEditor)
    await hostEditor.fill(original.replace('Install the thing.', 'Typed by the host.'))
    await expect(guestEditor).toContainText('Typed by the host.')

    await guestEditor.fill((await textOf(guestEditor)).replace('Typed by the host.', 'Answered by the guest.'))
    await expect(hostEditor).toContainText('Answered by the guest.')
    await expect.poll(() => site.read('content/guide/setup.md')).toContain('Answered by the guest.')

    await guestContext.close()
  })

  test('the write endpoint refuses other websites and requests without its token', async ({ request, site }) => {
    const before = await site.read('content/guide/setup.md')
    const write = (headers: Record<string, string>) =>
      request.put(`${DEV}/_shabd/studio/source`, {
        headers,
        data: { id: 'guide/setup.md', source: 'overwritten' },
      })

    expect((await write({})).status()).toBe(403)
    expect((await write({ 'x-shabd-studio': 'a-guess' })).status()).toBe(403)

    // A page on another site cannot read the token, and its requests are turned away before the token is checked.
    const session = await request.get(`${DEV}/_shabd/studio/session`)
    const { token } = (await session.json()) as { token: string }
    expect((await write({ 'x-shabd-studio': token, origin: 'https://elsewhere.example' })).status()).toBe(403)
    expect((await write({ 'x-shabd-studio': token, 'sec-fetch-site': 'cross-site' })).status()).toBe(403)
    expect(
      (await request.get(`${DEV}/_shabd/studio/session`, { headers: { 'sec-fetch-site': 'cross-site' } })).status(),
    ).toBe(403)

    // Even with the token, only files that are already pages can be written.
    const outside = await request.put(`${DEV}/_shabd/studio/source`, {
      headers: { 'x-shabd-studio': token },
      data: { id: '../shabd.config.yaml', source: 'site: {}' },
    })
    expect(outside.status()).toBe(400)
    expect(await site.read('content/guide/setup.md')).toBe(before)
  })

  /** The token the site's own pages are given. A request that carries it is taken for one of theirs, as far as the token goes. */
  const studioToken = async (request: APIRequestContext) =>
    ((await (await request.get(`${DEV}/_shabd/studio/session`)).json()) as { token: string }).token

  test('the endpoints that make, move and delete pages refuse other websites and requests without the token', async ({ request, site }) => {
    const token = await studioToken(request)
    const attempts: [what: string, send: (headers: Record<string, string>) => Promise<APIResponse>][] = [
      ['make a page', (headers) => request.post(`${DEV}/_shabd/studio/page`, { headers, data: { id: 'extras/made.md', source: 'made' } })],
      ['move a page', (headers) => request.patch(`${DEV}/_shabd/studio/page`, { headers, data: { id: 'extras/alpha.md', to: 'extras/moved.md' } })],
      ['delete a page', (headers) => request.delete(`${DEV}/_shabd/studio/page`, { headers, data: { id: 'extras/alpha.md' } })],
      ['read what check reports', (headers) => request.get(`${DEV}/_shabd/studio/check`, { headers })],
      ['ask about a redirect', (headers) => request.get(`${DEV}/_shabd/studio/redirect?from=/gone&to=/guide/intro`, { headers })],
      ['add a redirect', (headers) => request.post(`${DEV}/_shabd/studio/redirect`, { headers, data: { from: '/gone', to: '/guide/intro' } })],
    ]
    const config = await site.read('shabd.config.yaml')

    for (const [what, send] of attempts) {
      expect((await send({})).status(), `${what}, with no token`).toBe(403)
      expect((await send({ 'x-shabd-studio': 'a-guess' })).status(), `${what}, with a guessed token`).toBe(403)
      expect((await send({ 'x-shabd-studio': token, origin: 'https://elsewhere.example' })).status(), `${what}, from another origin`).toBe(403)
      expect((await send({ 'x-shabd-studio': token, 'sec-fetch-site': 'cross-site' })).status(), `${what}, from another site`).toBe(403)
      expect((await send({ 'x-shabd-studio': token, 'sec-fetch-site': 'same-site' })).status(), `${what}, from a sibling site`).toBe(403)
    }

    expect(existsSync(site.path('content/extras/made.md'))).toBe(false)
    expect(existsSync(site.path('content/extras/moved.md'))).toBe(false)
    expect(existsSync(site.path('content/extras/alpha.md'))).toBe(true)
    expect(await site.read('shabd.config.yaml')).toBe(config)
  })

  test('a new page, or the new place of one that moves, cannot be anywhere but a page in the content folder', async ({ request, site }) => {
    const headers = { 'x-shabd-studio': await studioToken(request) }
    const make = (id: unknown) => request.post(`${DEV}/_shabd/studio/page`, { headers, data: { id, source: 'made' } })
    const move = (to: unknown) => request.patch(`${DEV}/_shabd/studio/page`, { headers, data: { id: 'extras/alpha.md', to } })
    const alpha = await site.read('content/extras/alpha.md')

    // A folder beside the content folder, to see that nothing reaches it, and a link to it from inside.
    const elsewhere = site.path('elsewhere')
    await mkdir(elsewhere, { recursive: true })
    await symlink(elsewhere, site.path('content/linked'), 'junction')
    try {
      const outside = [
        '../made.md',
        '../elsewhere/made.md',
        '../../made.md',
        'extras/../../made.md',
        'extras/../../elsewhere/made.md',
        '..\\made.md',
        'extras\\..\\..\\made.md',
        site.path('made.md'),
        site.path('elsewhere/made.md'),
        '/tmp/made.md',
        'C:\\made.md',
        // Through the link: the path stays inside the content folder as text, and leaves it on disk.
        'linked/made.md',
        'linked/deeper/made.md',
      ]
      const notPages = [
        './made.md',
        'extras/./made.md',
        'extras//made.md',
        'extras/',
        'extras/made',
        'extras/made.txt',
        'extras/made.md.txt',
        'extras/made.html',
        '_made.md',
        'extras/_made.md',
        '_drafts/made.md',
        '.made.md',
        'extras/.hidden/made.md',
        '.git/made.md',
        'extras/ma\u0000de.md',
        'extras/ma\nde.md',
        ' made.md',
        '',
      ]
      for (const id of [...outside, ...notPages, 42, null, ['extras/made.md'], { path: 'extras/made.md' }]) {
        expect((await make(id)).status(), `make ${JSON.stringify(id)}`).toBe(400)
        expect((await move(id)).status(), `move to ${JSON.stringify(id)}`).toBe(400)
      }
      for (const file of ['made.md', 'elsewhere/made.md', '../made.md', 'content/made.md', 'content/_made.md', 'content/extras/made']) {
        expect(existsSync(site.path(file)), file).toBe(false)
      }
      expect(await readdir(elsewhere)).toEqual([])

      // Nothing is written over: not a page, not a file that is no page, and not the address a page already has.
      await site.write('content/extras/notes.txt', 'kept')
      await site.write('content/extras/_partial.md', 'kept')
      for (const taken of ['extras/alpha.md', 'extras/beta.md', 'index.mdx']) {
        expect((await make(taken)).status(), `make ${taken}`).toBe(409)
      }
      for (const taken of ['extras/beta.md', 'index.mdx', 'guide/setup.md']) {
        expect((await move(taken)).status(), `move to ${taken}`).toBe(409)
      }
      for (const sameAddress of ['extras/alpha.mdx', 'extras/alpha/index.md', 'Extras/Alpha.md', 'index.md', 'guide/intro/index.mdx']) {
        expect((await make(sameAddress)).status(), `make ${sameAddress}`).toBe(409)
      }
      expect((await move('extras/beta.mdx')).status()).toBe(409)
      expect((await move('extras/alpha.md')).status(), 'move to the name it has').toBe(400)
      expect(await site.read('content/extras/alpha.md')).toBe(alpha)
      expect(await site.read('content/extras/beta.md')).toContain('Beta notes')
      expect(await site.read('content/extras/notes.txt')).toBe('kept')
      expect(existsSync(site.path('content/extras/alpha.mdx'))).toBe(false)
      expect(existsSync(site.path('content/extras/alpha/index.md'))).toBe(false)

      // Only a page can be moved or deleted, and it is found by its name: a path gets nowhere.
      const notPageNames = ['../shabd.config.yaml', '../sidebar.yaml', 'extras/notes.txt', 'extras/_partial.md', 'extras', 'extras/', 'no/such.md']
      for (const id of [...notPageNames, site.path('content/extras/alpha.md'), 42, null]) {
        const moved = await request.patch(`${DEV}/_shabd/studio/page`, { headers, data: { id, to: 'extras/moved.md' } })
        expect(moved.status(), `move ${JSON.stringify(id)}`).toBe(404)
        const deleted = await request.delete(`${DEV}/_shabd/studio/page`, { headers, data: { id } })
        expect(deleted.status(), `delete ${JSON.stringify(id)}`).toBe(404)
      }
      for (const kept of ['shabd.config.yaml', 'sidebar.yaml', 'content/extras/notes.txt', 'content/extras/_partial.md', 'content/extras/alpha.md']) {
        expect(existsSync(site.path(kept)), kept).toBe(true)
      }
      expect(existsSync(site.path('content/extras/moved.md'))).toBe(false)

      // A page is not deleted if it is no longer what the Studio showed.
      const stale = await request.delete(`${DEV}/_shabd/studio/page`, { headers, data: { id: 'extras/alpha.md', baseHash: 'not-its-hash' } })
      expect(stale.status()).toBe(409)
      expect(await site.read('content/extras/alpha.md')).toBe(alpha)
    } finally {
      await rm(site.path('content/linked'), { force: true })
      await rm(elsewhere, { recursive: true, force: true })
    }
  })

  test('the same endpoints do make, move and delete a page that is asked for properly', async ({ request, site }) => {
    const headers = { 'x-shabd-studio': await studioToken(request) }
    for (const file of ['content/extras/made.md', 'content/handbook/start/moved.mdx']) await site.track(file)

    const made = await request.post(`${DEV}/_shabd/studio/page`, { headers, data: { id: 'extras/made.md', source: '# Made\n' } })
    expect(made.status()).toBe(201)
    expect(await made.json()).toEqual({ id: 'extras/made.md', path: '/extras/made' })
    expect(await site.read('content/extras/made.md')).toBe('# Made\n')
    await expect.poll(async () => (await request.get(`${DEV}/extras/made`)).status()).toBe(200)

    // Into folders that are not there yet.
    const moved = await request.patch(`${DEV}/_shabd/studio/page`, { headers, data: { id: 'extras/made.md', to: 'handbook/start/moved.mdx' } })
    expect(await moved.json()).toEqual({ id: 'handbook/start/moved.mdx', path: '/handbook/start/moved', from: '/extras/made' })
    expect(existsSync(site.path('content/extras/made.md'))).toBe(false)
    expect(await site.read('content/handbook/start/moved.mdx')).toBe('# Made\n')
    await expect.poll(async () => (await request.get(`${DEV}/extras/made`)).status()).toBe(404)
    await expect.poll(async () => (await request.get(`${DEV}/handbook/start/moved`)).status()).toBe(200)

    const deleted = await request.delete(`${DEV}/_shabd/studio/page`, { headers, data: { id: 'handbook/start/moved.mdx' } })
    expect(deleted.status()).toBe(200)
    expect(existsSync(site.path('content/handbook/start/moved.mdx'))).toBe(false)
    await expect.poll(async () => (await request.get(`${DEV}/handbook/start/moved`)).status()).toBe(404)
    await rm(site.path('content/handbook'), { recursive: true, force: true })
  })

  test('a page made a moment after another was deleted still reaches the page on screen, which is not loaded again', async ({ page, request, site }) => {
    for (const file of ['content/extras/beta.md', 'content/extras/kappa.md']) await site.track(file)
    const headers = { 'x-shabd-studio': await studioToken(request) }
    await open(page, `${DEV}/guide/intro`)
    const stillThere = await markPage(page)
    const extras = page.locator('.sb-nav-category', { hasText: 'Extras' })
    await expect(extras.locator('.sb-nav-link')).toHaveText(['Alpha notes', 'Beta notes'])

    // The file is gone from disk, and the watcher will say so in a tenth of a second. Before it has, a new
    // page arrives by a way that does not wait for the watcher, and the list of pages is made again with the
    // deleted one still on it. That list once failed to compile, and the browser loaded the page again.
    await rm(site.path('content/extras/beta.md'))
    const made = await request.post(`${DEV}/_shabd/studio/page`, {
      headers,
      data: { id: 'extras/kappa.md', source: '---\ntitle: Kappa notes\n---\n\nMade.\n' },
    })
    expect(made.status()).toBe(201)

    await expect(extras.locator('.sb-nav-link')).toHaveText(['Alpha notes', 'Kappa notes'])
    await extras.getByRole('link', { name: 'Kappa notes' }).click()
    await expect(page).toHaveURL(`${DEV}/extras/kappa`)
    await expect(page.locator('.sb-content')).toContainText('Made.')
    expect(await stillThere()).toBe(true)
  })

  test('a redirect is added only from an address a page has left to a page, and the config is otherwise left as it was', async ({ request, site }) => {
    const headers = { 'x-shabd-studio': await studioToken(request) }
    const config = await site.read('shabd.config.yaml')
    const ask = (from: string, to: string) => request.get(`${DEV}/_shabd/studio/redirect`, { headers, params: { from, to } })
    const add = (from: unknown, to: unknown) => request.post(`${DEV}/_shabd/studio/redirect`, { headers, data: { from, to } })

    for (const [from, to] of [
      ['/gone', '/no/such/page'],
      ['/gone', 'https://elsewhere.example/'],
      ['/gone', '//elsewhere.example/'],
      ['/gone', '/guide/intro#getting-started'],
      // From where a page is, or where a redirect already starts.
      ['/guide/setup', '/guide/intro'],
      ['/guide/start', '/guide/setup'],
      ['https://elsewhere.example/', '/guide/intro'],
      ['gone', '/guide/intro'],
      ['/gone/', '/guide/intro'],
      ['/gone\n  /injected: /guide/setup', '/guide/intro'],
      [42, '/guide/intro'],
    ] as const) {
      expect((await add(from, to)).status(), `${String(from)} → ${to}`).toBe(409)
    }
    expect(await (await ask('/gone', '/no/such/page')).json()).toMatchObject({
      possible: false,
      reason: 'There is no page at /no/such/page to send readers to.',
    })
    expect(await site.read('shabd.config.yaml')).toBe(config)

    // One that is in order: one line more, after the last redirect, and nothing else different.
    await site.track('shabd.config.yaml')
    expect(await (await ask('/gone', '/guide/intro')).json()).toEqual({ possible: true, line: '/gone: /guide/intro' })
    expect(await site.read('shabd.config.yaml')).toBe(config)
    expect((await add('/gone', '/guide/intro')).status()).toBe(200)
    expect(await site.read('shabd.config.yaml')).toBe(config.replace('#second-step\n', '#second-step\n  /gone: /guide/intro\n'))
    // The server sends readers on at once.
    const sent = await request.get(`${DEV}/gone`, { maxRedirects: 0 })
    expect([sent.status(), sent.headers().location]).toEqual([302, '/guide/intro'])
    // And not twice from one address.
    expect((await add('/gone', '/guide/setup')).status()).toBe(409)
  })
})

test.describe('dev endpoints', () => {
  test('llms.txt and the MCP route read the files as they are now', async ({ request, site }) => {
    await site.write('content/extras/delta.md', '---\ntitle: Delta notes\ndescription: Fresh.\n---\n\nQuokkas live here.\n')
    await expect
      .poll(async () => (await request.get(`${DEV}/llms.txt`)).text())
      .toContain('- [Delta notes](https://fixture.test/extras/delta.md): Fresh.')

    const markdown = await request.get(`${DEV}/extras/delta.md`)
    expect(await markdown.text()).toBe('# Delta notes\n\n> Fresh.\n\nQuokkas live here.\n')

    const call = (origin?: string) =>
      request.post(`${DEV}/mcp`, {
        headers: { accept: 'application/json, text/event-stream', ...(origin ? { origin } : {}) },
        data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_docs', arguments: { query: 'quokkas' } } },
      })
    const found = (await (await call()).json()) as { result: { content: { text: string }[] } }
    expect(found.result.content[0]?.text).toContain('path: /extras/delta')
    // In dev the endpoint is for tools on this machine, not for other websites.
    expect((await call('https://elsewhere.example')).status()).toBe(403)
  })

  test('the feed is written from the files as they are now', async ({ request, site }) => {
    await site.write('content/extras/epsilon.md', '---\ntitle: Epsilon notes\ndate: 2026-06-07\n---\n\nNew.\n')
    await expect.poll(async () => (await request.get(`${DEV}/rss.xml`)).text()).toContain('<title>Epsilon notes</title>')
    expect((await request.get(`${DEV}/rss.xml`)).headers()['content-type']).toContain('application/rss+xml')
  })

  test('an address that has moved is answered with a redirect', async ({ request, page }) => {
    const moved = await request.get(`${DEV}/guide/start`, { maxRedirects: 0 })
    expect(moved.status()).toBe(302)
    expect(moved.headers().location).toBe('/guide/intro')

    await open(page, `${DEV}/old-setup`)
    await expect(page).toHaveURL(`${DEV}/guide/setup#second-step`)
  })
})
