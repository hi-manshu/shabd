/**
 * The editor of a live sandbox: the code editor the Studio has, with the
 * grammar of a snippet. Its code is coloured as it is typed, and it can be
 * reached and left with the keyboard alone.
 */
import AxeBuilder from '@axe-core/playwright'
import { editorText, snippetEditor } from './support/editor.js'
import { BUILT, expect, open, test } from './support/fixtures.js'

test.describe('the editor of a sandbox', () => {
  test('colours the code of the snippet, and what is typed into it', async ({ page, problems }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await open(page, `${BUILT}/play/sandbox`)
    const box = page.locator('.sb-sandbox').first()
    const editor = snippetEditor(box)
    await expect(editor).toBeEditable({ timeout: 20_000 })
    // What the page was written with is what the editor holds.
    expect(await editorText(editor)).toContain("const [count, setCount] = useShared('count', 0)")

    /** The colour of the piece of code that reads exactly `text`. */
    const colourOf = (text: string) =>
      editor
        .locator('.cm-line span', { hasText: new RegExp(`^${text}$`) })
        .first()
        .evaluate((span) => getComputedStyle(span).color)
    const plain = await editor.evaluate((element) => getComputedStyle(element).color)
    const keyword = await colourOf('export')
    const text = await colourOf("'count'")
    // A keyword and a piece of text are each in a colour of their own, and neither is the colour of plain code.
    expect(new Set([plain, keyword, text]).size).toBe(3)

    // What is typed is coloured as it is typed, and runs.
    await editor.fill('export default function Typed() {\n  return <b>{"typed just now"}</b>\n}')
    await expect(box.locator('.sb-sandbox-stage b')).toHaveText('typed just now')
    expect(await colourOf('function')).toBe(keyword)
    expect(await colourOf('"typed just now"')).toBe(text)

    // The colours are the palette's, so they change with the mode the reader chooses.
    await page.getByRole('button', { name: 'Switch colour theme' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect.poll(() => colourOf('function')).not.toBe(keyword)
    expect(problems).toEqual([])
  })

  test('is reached and left with the keyboard, and says how', async ({ page, browserName }) => {
    await open(page, `${BUILT}/play/sandbox`)
    const box = page.locator('.sb-sandbox').first()
    const editor = snippetEditor(box)
    await expect(editor).toBeEditable({ timeout: 20_000 })

    await editor.click()
    await page.keyboard.press('ControlOrMeta+Home')
    // Tab indents the line: it does not move on, so the editor says how to.
    await page.keyboard.press('Tab')
    expect((await editorText(editor)).split('\n')[0]).toBe('  export default function Clicker() {')
    const hint = box.locator('.sb-editor-hint')
    await expect(hint).toBeVisible()
    await expect(hint).toHaveText('Tab indents. To move on by keyboard, press Esc, then Tab.')
    expect(await editor.getAttribute('aria-describedby')).toBe(await hint.getAttribute('id'))

    // Esc, then Tab: focus leaves the editor. WebKit reaches links and buttons with Option + Tab.
    await page.keyboard.press('Escape')
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
    await expect.poll(() => editor.evaluate((element) => element.contains(document.activeElement))).toBe(false)
    // The line is as it was left: the Tab that moved on was not typed.
    expect((await editorText(editor)).split('\n')[0]).toBe('  export default function Clicker() {')
  })

  test('gives a checker nothing to find on a page of sandboxes, in either mode', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await open(page, `${BUILT}/play/sandbox`)
      await expect(snippetEditor(page.locator('.sb-sandbox').first())).toBeEditable({ timeout: 20_000 })
      // The frames of the isolated snippets are looked into as well.
      await expect(page.locator('.sb-sandbox-wait')).toHaveCount(0, { timeout: 20_000 })
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze()
      expect(violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')} — ${node.failureSummary?.split('\n')[1]?.trim() ?? violation.help}`))).toEqual([])
    }
  })
})
