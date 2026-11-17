/** The dev server: files change on disk and the page on screen follows, without loading again. */
import { existsSync } from 'node:fs'
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

  test('the editor shows its Markdown in colour, with the colours under the letters', async ({ page, site }) => {
    await site.track('content/guide/setup.md')
    const editor = await openStudio(page, '/guide/setup')
    const colours = page.locator('.sb-studio-colours')

    // Lines that wrap, a tab, spaces at the end of a line, a word wider than the panel and an empty last
    // line: the places where a text area and a copy of its text could come apart.
    const source = [
      '---',
      'title: Setting up',
      '---',
      '',
      '# Setting up',
      '',
      `A paragraph long enough to wrap in a panel this narrow, with **strong words**, \`code\`, a [link](./intro.md) and ${'more '.repeat(40)}text.`,
      '',
      '- one',
      '\t- two, after a tab',
      '- three   ',
      '',
      '```ts',
      'const answer = 42 // not *emphasis*',
      '```',
      '',
      'averyveryverylongwordwithoutanyspaces'.repeat(6),
      '',
      '',
    ].join('\n')
    await editor.fill(source)

    // The coloured layer holds the same text, line for line.
    expect(await colours.locator('.sb-studio-line').evaluateAll((lines) => lines.map((line) => line.textContent))).toEqual(source.split('\n'))
    await expect(colours.locator('.sbs-heading')).toHaveText(' Setting up')
    await expect(colours.locator('.sbs-key')).toHaveText('title')
    await expect(colours.locator('.sbs-strong')).toHaveText('strong words')
    await expect(colours.locator('.sbs-link')).toHaveText('./intro.md')
    await expect(colours.locator('.sbs-code').first()).toHaveText('code')
    // Nothing in a code block is Markdown.
    await expect(colours.locator('.sbs-em')).toHaveCount(0)

    // Both layers break their lines at the same places: left to its own height, the text area is as tall as the copy.
    const sizes = await page.evaluate(() => {
      const area = document.querySelector<HTMLTextAreaElement>('.sb-studio-editor')!
      const layer = document.querySelector<HTMLElement>('.sb-studio-colours')!
      const filled = area.offsetHeight
      area.style.blockSize = '0px'
      const own = area.scrollHeight
      area.style.blockSize = ''
      return { own, filled, layer: layer.offsetHeight, widths: [area.clientWidth, layer.clientWidth] }
    })
    expect(sizes.own).toBe(sizes.layer)
    expect(sizes.filled).toBe(sizes.layer)
    expect(sizes.widths[0]).toBe(sizes.widths[1])
    expect(sizes.layer).toBeGreaterThan(600)

    // The letters on screen are the copy's. The text area's own are not drawn a second time.
    const inks = await page.evaluate(() => ({
      area: getComputedStyle(document.querySelector('.sb-studio-editor')!).color,
      text: getComputedStyle(document.querySelector('.sb-studio-colours')!).color,
      heading: getComputedStyle(document.querySelector('.sbs-heading')!).color,
    }))
    expect(inks.area).toMatch(/^rgba\(0, 0, 0, 0\)$|^transparent$/)
    expect(inks.heading).not.toBe(inks.text)
    // Let the save finish: one that lands after the test would undo the tidying up.
    await expect(page.locator('.sb-studio-footer')).toContainText('Saved.')
  })

  test('a page shorter than the panel can be clicked anywhere below its text', async ({ page, site }) => {
    await site.track('content/guide/setup.md')
    const editor = await openStudio(page, '/guide/setup')
    await editor.fill('# Short\n')
    const box = (await page.locator('.sb-studio-code').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 20)
    await expect(editor).toBeFocused()
    await expect(page.locator('.sb-studio-footer')).toContainText('Saved.')
  })

  test('Tab, Enter and the shortcuts edit as in a code editor, and undo takes them back', async ({ page, site, browserName }) => {
    await site.track('content/guide/setup.md')
    const editor = await openStudio(page, '/guide/setup')
    const caretAtEnd = () => editor.evaluate((area: HTMLTextAreaElement) => area.setSelectionRange(area.value.length, area.value.length))
    const select = (text: string) =>
      editor.evaluate((area: HTMLTextAreaElement, part) => {
        const at = area.value.indexOf(part)
        area.setSelectionRange(at, at + part.length)
      }, text)

    // Enter goes on with a list, and ends it on an empty item.
    await editor.fill('- one')
    await caretAtEnd()
    await editor.press('Enter')
    await expect(editor).toHaveValue('- one\n- ')
    await page.keyboard.type('two')
    await editor.press('Enter')
    await editor.press('Enter')
    await expect(editor).toHaveValue('- one\n- two\n')
    await page.keyboard.type('3. three')
    await editor.press('Enter')
    await expect(editor).toHaveValue('- one\n- two\n3. three\n4. ')

    // Tab types two spaces, and stays in the editor.
    await page.keyboard.type('x')
    await editor.press('Tab')
    await expect(editor).toHaveValue('- one\n- two\n3. three\n4. x  ')
    await expect(editor).toBeFocused()

    // With lines selected, Tab moves them in and Shift+Tab moves them out.
    await editor.fill('one\ntwo\n\nthree')
    await editor.press('ControlOrMeta+a')
    await editor.press('Tab')
    await expect(editor).toHaveValue('  one\n  two\n\n  three')
    await editor.press('Shift+Tab')
    await expect(editor).toHaveValue('one\ntwo\n\nthree')

    // Bold and italic wrap the selection. What is typed this way is saved like any other typing.
    await select('two')
    await editor.press('ControlOrMeta+b')
    await expect(editor).toHaveValue('one\n**two**\n\nthree')
    const footer = page.locator('.sb-studio-footer')
    await expect(footer).toContainText('Saved.')
    expect(await site.read('content/guide/setup.md')).toBe('one\n**two**\n\nthree')

    // The browser's own undo takes such an edit back.
    await select('three')
    await editor.press('ControlOrMeta+i')
    await expect(editor).toHaveValue('one\n**two**\n\n_three_')
    await editor.press('ControlOrMeta+z')
    // How much one undo takes back is the browser's choice. WebKit, as the tests drive it, takes back all
    // that was typed since the page was opened, in any text area. The other two take back the last edit.
    if (browserName === 'webkit') await expect(editor).not.toHaveValue(/_three_/)
    else await expect(editor).toHaveValue('one\n**two**\n\nthree')

    // The keyboard can still leave: Escape, then Tab.
    await editor.press('Escape')
    await editor.press('Tab')
    await expect(editor).not.toBeFocused()

    // Text that was typed and taken back before it was written leaves nothing unsaved.
    await expect(footer).toContainText(/Saved\.|Changes are saved as you type\./)
  })

  test('keeps the caret in view while typing at the end of a long page', async ({ page, site }) => {
    await site.track('content/guide/setup.md')
    const editor = await openStudio(page, '/guide/setup')
    await editor.fill(Array.from({ length: 150 }, (_, index) => `Line ${index + 1}`).join('\n'))
    const box = page.locator('.sb-studio-code')
    const below = () => box.evaluate((element) => Math.round(element.scrollHeight - element.scrollTop - element.clientHeight))
    await box.evaluate((element) => (element.scrollTop = 0))
    expect(await below()).toBeGreaterThan(1000)

    await editor.evaluate((area: HTMLTextAreaElement) => {
      area.focus({ preventScroll: true })
      area.setSelectionRange(area.value.length, area.value.length)
    })
    await page.keyboard.type('!')
    await expect(editor).toHaveValue(/Line 150!$/)
    // The line that was typed in is on screen: the panel has scrolled to its end.
    await expect.poll(below).toBeLessThan(30)
    await expect(page.locator('.sb-studio-footer')).toContainText('Saved.')
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
    const original = await hostEditor.inputValue()
    await hostEditor.fill(original.replace('Install the thing.', 'Typed by the host.'))
    await expect(guestEditor).toHaveValue(/Typed by the host\./)

    await guestEditor.fill((await guestEditor.inputValue()).replace('Typed by the host.', 'Answered by the guest.'))
    await expect(hostEditor).toHaveValue(/Answered by the guest\./)
    await expect.poll(() => site.read('content/guide/setup.md')).toContain('Answered by the guest.')

    await guestContext.close()
  })

  test('creates a page, renames it with its sidebar entry, and deletes it', async ({ page, site }) => {
    await site.track('sidebar.yaml')
    await site.track('content/guide/notes.md')
    await site.track('content/guide/field-notes.md')
    await openStudio(page, '/guide/setup')
    const stillThere = await markPage(page)
    const actions = page.locator('.sb-studio-pages')

    // A path that is taken, and one outside the content folder, are refused with the reason.
    await actions.getByRole('button', { name: 'New page' }).click()
    await expect(actions.getByRole('textbox')).toHaveValue('guide/new-page.md')
    await actions.getByRole('textbox').fill('guide/setup.md')
    await actions.getByRole('button', { name: 'Create' }).click()
    await expect(actions.getByRole('alert')).toContainText('guide/setup.md exists already')
    await actions.getByRole('textbox').fill('../outside.md')
    await actions.getByRole('button', { name: 'Create' }).click()
    await expect(actions.getByRole('alert')).toContainText('inside the content folder')

    // A new page is a file with a title, and the Studio moves to it.
    await actions.getByRole('textbox').fill('guide/notes.md')
    await actions.getByRole('button', { name: 'Create' }).click()
    await expect(page).toHaveURL(`${DEV}/guide/notes`)
    await expect(page.locator('h1.sb-page-title')).toHaveText('Notes')
    await expect(page.locator('.sb-studio-file strong')).toHaveText('content/guide/notes.md')
    await expect(page.locator('.sb-studio-editor')).toHaveValue(/Write the page here/)
    expect(await site.read('content/guide/notes.md')).toBe('---\ntitle: "Notes"\n---\n\nWrite the page here.\n')

    // Once the sidebar file lists the page, a rename keeps that entry pointing at it.
    await site.edit('sidebar.yaml', (text) => text.replace('    - guide/intro\n', '    - guide/intro\n    - guide/notes\n'))
    const sidebar = page.locator('.sb-region-sidebar')
    await expect(sidebar.locator('.sb-nav-link').nth(1)).toHaveText('Notes')
    await actions.getByRole('button', { name: 'Rename' }).click()
    await expect(actions.getByRole('textbox')).toHaveValue('guide/notes.md')
    await actions.getByRole('textbox').fill('guide/field-notes.md')
    await actions.getByRole('button', { name: 'Rename' }).click()
    await expect(page).toHaveURL(`${DEV}/guide/field-notes`)
    await expect(actions).toContainText('Now content/guide/field-notes.md. sidebar.yaml follows.')
    expect(await site.read('sidebar.yaml')).toContain('    - guide/intro\n    - guide/field-notes\n')
    expect(existsSync(site.path('content/guide/notes.md'))).toBe(false)
    expect(await site.read('content/guide/field-notes.md')).toContain('Write the page here.')
    await expect(sidebar.locator('.sb-nav-link').nth(1)).toHaveText('Notes')
    await expect(page.locator('.sb-studio-file strong')).toHaveText('content/guide/field-notes.md')

    // Deleting removes the file and its sidebar entry, and leaves the reader on the home page.
    await actions.getByRole('button', { name: 'Delete' }).click()
    await expect(actions).toContainText('Delete content/guide/field-notes.md?')
    await actions.getByRole('button', { name: 'Delete the page' }).click()
    await expect(page).toHaveURL(`${DEV}/`)
    await expect(actions).toContainText('Its entry is out of sidebar.yaml.')
    expect(existsSync(site.path('content/guide/field-notes.md'))).toBe(false)
    expect(await site.read('sidebar.yaml')).not.toContain('field-notes')
    expect(await stillThere()).toBe(true)
  })

  test('says when the sidebar file still lists a page that was deleted', async ({ request, site }) => {
    await site.track('sidebar.yaml')
    await site.track('content/play/lonely.md')
    const { token } = (await (await request.get(`${DEV}/_shabd/studio/session`)).json()) as { token: string }
    const pages = (method: 'post' | 'delete', data: Record<string, string>) =>
      request[method](`${DEV}/_shabd/studio/page`, { headers: { 'x-shabd-studio': token }, data })

    expect((await pages('post', { id: 'play/lonely.md' })).status()).toBe(201)
    // The only entry of its list: without it, the category would have nothing in it. That is not the Studio's to decide.
    await site.edit('sidebar.yaml', (text) =>
      text.replace('- link: https://example.com\n', '- category: Alone\n  items:\n    - play/lonely\n- link: https://example.com\n'),
    )
    const listed = await site.read('sidebar.yaml')

    const gone = await pages('delete', { id: 'play/lonely.md' })
    expect(gone.status()).toBe(200)
    expect(await gone.json()).toEqual({ id: 'play/lonely.md', sidebar: 'mentions' })
    expect(existsSync(site.path('content/play/lonely.md'))).toBe(false)
    expect(await site.read('sidebar.yaml')).toBe(listed)
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

    // The same holds for creating, renaming and deleting pages.
    const pages = (method: 'post' | 'patch' | 'delete', data: Record<string, string>, headers: Record<string, string> = { 'x-shabd-studio': token }) =>
      request[method](`${DEV}/_shabd/studio/page`, { headers, data })
    expect((await pages('post', { id: 'guide/sneaky.md' }, {})).status()).toBe(403)
    expect((await pages('delete', { id: 'guide/setup.md' }, { 'x-shabd-studio': token, origin: 'https://elsewhere.example' })).status()).toBe(403)
    for (const id of ['../outside.md', '/tmp/outside.md', 'guide/../../outside.md', '_private/x.md', 'guide/x.txt']) {
      expect((await pages('post', { id })).status(), id).toBe(400)
      expect((await pages('patch', { id: 'guide/setup.md', to: id })).status(), id).toBe(400)
    }
    expect((await pages('patch', { id: 'guide/setup.md', to: 'guide/intro.md' })).status()).toBe(409)
    expect((await pages('delete', { id: '../shabd.config.yaml' })).status()).toBe(404)
    expect(existsSync(site.path('outside.md'))).toBe(false)
    expect(await site.read('content/guide/setup.md')).toBe(before)
    expect(existsSync(site.path('shabd.config.yaml'))).toBe(true)
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
