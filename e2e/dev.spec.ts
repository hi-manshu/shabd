/** The dev server: files change on disk and the page on screen follows, without loading again. */
import type { Page } from '@playwright/test'
import { DEV, expect, markPage, open, regions, test } from './support/fixtures.js'

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

  test('a mistake in the config is shown over the page, and clears when it is fixed', async ({ page, site }) => {
    await open(page, `${DEV}/guide/intro`)

    await site.edit('shabd.config.yaml', (text) => text.replace('description: A site', 'descripton: A site'))
    const overlay = page.locator('vite-error-overlay')
    await expect(overlay).toBeAttached()
    await expect(overlay.locator('.message-body')).toContainText('Unknown key "descripton". Did you mean "description"?')
    await expect(overlay.locator('.file')).toContainText('shabd.config.yaml:4:3')

    // Vite reloads the page when the first update it receives follows an error, so no in-place check here.
    await site.edit('shabd.config.yaml', (text) => text.replace('descripton: A site', 'description: A site'))
    await expect(overlay).not.toBeAttached()
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
  const openStudio = async (page: Page, path: string) => {
    await open(page, `${DEV}${path}`)
    await page.getByRole('button', { name: 'Edit page' }).click()
    const editor = page.locator('.sb-studio-editor')
    await expect(editor).toBeEnabled()
    return editor
  }

  test('typing saves to the file and updates the page beside it', async ({ page, site }) => {
    await site.track('content/guide/setup.md')
    const editor = await openStudio(page, '/guide/setup')
    const stillThere = await markPage(page)
    await expect(page.locator('.sb-studio-file strong')).toHaveText('content/guide/setup.md')
    await expect(editor).toHaveValue(/^# Setting up/)

    await editor.fill((await editor.inputValue()).replace('Install the thing.', 'Install the other thing.'))
    await expect(page.locator('.sb-content')).toContainText('Install the other thing.')
    await expect(page.locator('.sb-studio-footer')).toContainText(/Saved\. The page updated \d+ ms later\./)
    expect(await site.read('content/guide/setup.md')).toContain('Install the other thing.')
    expect(await stillThere()).toBe(true)
  })

  test('follows the file when it changes on disk and nothing is unsaved', async ({ page, site }) => {
    const editor = await openStudio(page, '/guide/setup')
    await site.edit('content/guide/setup.md', (text) => text.replace('Install the thing.', 'Changed in another editor.'))
    await expect(editor).toHaveValue(/Changed in another editor\./)
  })

  test('asks which version to keep when the file and the draft both changed', async ({ page, site }) => {
    const editor = await openStudio(page, '/guide/setup')
    const original = await editor.inputValue()

    // Type, and before the pause that triggers a save is over, change the file underneath.
    await editor.fill(original.replace('Install the thing.', 'My draft.'))
    await site.write('content/guide/setup.md', original.replace('Install the thing.', 'Their change.'))

    const footer = page.locator('.sb-studio-footer')
    await expect(footer).toContainText('This file was changed outside the Studio.')
    expect(await site.read('content/guide/setup.md')).toContain('Their change.')

    await footer.getByRole('button', { name: 'Load the file from disk' }).click()
    await expect(editor).toHaveValue(/Their change\./)

    // The other way round: keep the draft, and it is written over the file.
    await editor.fill(original.replace('Install the thing.', 'My second draft.'))
    await site.write('content/guide/setup.md', original.replace('Install the thing.', 'Their second change.'))
    await expect(footer).toContainText('This file was changed outside the Studio.')
    await footer.getByRole('button', { name: 'Keep my version' }).click()
    await expect.poll(() => site.read('content/guide/setup.md')).toContain('My second draft.')
  })

  test('saves through a connected folder with the File System Access API', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the File System Access API only exists in Chromium browsers')

    // The real folder picker is a system dialog that a test cannot click.
    // Stand in for it with a directory from the origin-private file system,
    // which hands out the same kind of handles the picker would.
    await page.addInitScript(() => {
      const contentFolder = async () => {
        const root = await navigator.storage.getDirectory()
        return root.getDirectoryHandle('content', { create: true })
      }
      Object.defineProperty(window, 'showDirectoryPicker', { value: contentFolder, configurable: true })
    })

    const readStored = () =>
      page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        const guide = await (await root.getDirectoryHandle('content')).getDirectoryHandle('guide')
        return (await (await guide.getFileHandle('setup.md')).getFile()).text()
      })
    const writeStored = (text: string) =>
      page.evaluate(async (contents) => {
        const root = await navigator.storage.getDirectory()
        const content = await root.getDirectoryHandle('content', { create: true })
        const guide = await content.getDirectoryHandle('guide', { create: true })
        const writable = await (await guide.getFileHandle('setup.md', { create: true })).createWritable()
        await writable.write(contents)
        await writable.close()
      }, text)

    const editor = await openStudio(page, '/guide/setup')
    const label = page.locator('.sb-studio-file span')
    await expect(label).toHaveText('Saving through the dev server')
    await writeStored('# Setting up\n\nThe copy in the folder.\n')

    await page.getByRole('button', { name: 'Connect a folder' }).click()
    await expect(label).toHaveText('Writing to the “content” folder on this device')
    await expect(editor).toHaveValue('# Setting up\n\nThe copy in the folder.\n')

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
    await expect(page.locator('.sb-studio-editor')).toHaveValue('# Setting up\n\nChanged by something else.\n')
  })

  test('two editors connect peer to peer and share a draft', async ({ page, browser, site }) => {
    await site.track('content/guide/setup.md')
    const host = page
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
    const original = await hostEditor.inputValue()
    await hostEditor.fill(original.replace('Install the thing.', 'Typed by the host.'))
    await expect(guestEditor).toHaveValue(/Typed by the host\./)

    await guestEditor.fill((await guestEditor.inputValue()).replace('Typed by the host.', 'Answered by the guest.'))
    await expect(hostEditor).toHaveValue(/Answered by the guest\./)
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
})
