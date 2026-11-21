/**
 * Isolated snippets: a live fence that says `isolated` runs in a frame of its
 * own. The frame can reach nothing of the page, and is given what it needs by
 * messages: its script, the snippet, the shared state, and how the page looks.
 */
import type { Page } from '@playwright/test'
import { editorText, snippetEditor } from './support/editor.js'
import { BUILT, DEV, expect, open, test } from './support/fixtures.js'

const sandbox = (page: Page, title: string) => page.locator('.sb-sandbox', { has: page.locator('.sb-code-label', { hasText: title }) })
/** The document inside a sandbox's frame. */
const inside = (page: Page, title: string) => sandbox(page, title).frameLocator('.sb-sandbox-frame')

for (const [where, origin] of [
  ['a built site', BUILT],
  ['the dev server', DEV],
] as const) {
  test.describe(`an isolated snippet, on ${where}`, () => {
    test('runs in a frame, with a module the site names, and shares its state with the page', async ({ page, problems }) => {
      await open(page, `${origin}/play/sandbox`)
      const box = sandbox(page, 'Apart')
      const frame = inside(page, 'Apart')
      const gauge = frame.locator('[data-gauge]')

      // The snippet imports a file of the site's, which is in the frame's script.
      await expect(gauge).toHaveText('2 bar', { timeout: 30_000 })
      // The value is the page's too: its panel lists it.
      const panel = box.locator('.sb-sandbox-state input')
      await expect(panel).toHaveValue('2')

      // Set in the frame, it is set in the page; set in the page, it is set in the frame.
      await frame.getByRole('button', { name: 'Raise' }).click()
      await expect(gauge).toHaveText('3 bar')
      await expect(panel).toHaveValue('3')
      await panel.fill('7')
      await expect(gauge).toHaveText('7 bar')

      // Editing the code keeps the state, and a mistake keeps what ran last.
      const editor = snippetEditor(box)
      const code = await editorText(editor)
      await editor.fill(code.replace('>Raise<', '>Lift<'))
      await expect(frame.getByRole('button', { name: 'Lift' })).toBeVisible()
      await expect(gauge).toHaveText('7 bar')
      await editor.fill(code.replace('return (', 'return (('))
      await expect(box.locator('.sb-sandbox-problem')).toBeVisible()
      await expect(frame.getByRole('button', { name: 'Lift' })).toBeVisible()

      // Nothing so far was worth a word in the console: not the frame's start, not its fonts, not the mistake.
      expect(problems).toEqual([])

      // What the snippet throws when it is drawn is said in the page. React also writes it to the
      // console, where its author finds the place it was thrown from.
      await editor.fill("export default function Broken() {\n  throw new Error('It broke in the frame')\n}")
      await expect(box.locator('.sb-sandbox-problem')).toHaveText('It broke in the frame')
      await box.getByRole('button', { name: 'Reset code' }).click()
      await expect(gauge).toHaveText('7 bar')
      await expect(box.locator('.sb-sandbox-problem')).toHaveCount(0)
    })

    test('cannot reach the page it is shown in, or the storage of the site', async ({ page }) => {
      await open(page, `${origin}/play/sandbox`)
      await expect(inside(page, 'Reach').locator('output')).toHaveText('page: refused; storage: refused', { timeout: 30_000 })
      // Scripts, and nothing else.
      await expect(sandbox(page, 'Reach').locator('.sb-sandbox-frame')).toHaveAttribute('sandbox', 'allow-scripts')
      // The same code in the page reads both: the refusal is the frame's, not the snippet's.
      expect(await page.evaluate(() => [typeof window.parent.document.title, typeof window.localStorage])).toEqual(['string', 'object'])
    })

    test('looks like the page: its colours, its fonts, and the mode the reader chooses', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' })
      await open(page, `${origin}/play/sandbox`)
      const frame = inside(page, 'Apart')
      await expect(frame.locator('[data-gauge]')).toHaveText('2 bar', { timeout: 30_000 })

      const look = () =>
        Promise.all([
          page.locator('.sb-content').evaluate((element) => {
            const style = getComputedStyle(element)
            return { color: style.color, font: style.fontFamily, theme: document.documentElement.dataset.theme }
          }),
          frame.locator('body').evaluate((element) => {
            const style = getComputedStyle(element)
            return { color: style.color, font: style.fontFamily, theme: document.documentElement.dataset.theme }
          }),
        ])
      const [pageLook, frameLook] = await look()
      expect(frameLook).toEqual(pageLook)
      expect(frameLook.theme).toBe('light')

      // The page's font, which the frame may not fetch, is given to it as bytes.
      const family = pageLook.font.split(',')[0]!.trim().replace(/^["']|["']$/g, '')
      await expect
        .poll(() => frame.locator('body').evaluate((_, name) => [...document.fonts].some((face) => face.family.replace(/^["']|["']$/g, '') === name && face.status === 'loaded'), family))
        .toBe(true)

      // The frame is as tall as what is in it, and shows through to the stage behind it.
      const size = () => frame.locator('html').evaluate((element) => ({ content: element.getBoundingClientRect().height, window: window.innerHeight, background: getComputedStyle(document.body).backgroundColor }))
      await expect.poll(async () => Math.abs((await size()).content - (await size()).window)).toBeLessThanOrEqual(1)
      expect((await size()).content).toBeGreaterThan(40)
      // It is drawn in the colour of the stage it is on, so that its text is on a colour of its own.
      const behind = () => sandbox(page, 'Apart').locator('.sb-sandbox-result').evaluate((element) => getComputedStyle(element).backgroundColor)
      expect((await size()).background).toBe(await behind())
      expect(await behind()).not.toBe('rgba(0, 0, 0, 0)')

      // The reader turns the page dark, and the frame follows without starting again.
      await frame.getByRole('button', { name: 'Raise' }).click()
      await page.getByRole('button', { name: 'Switch colour theme' }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await expect.poll(async () => (await look())[1].theme).toBe('dark')
      const [darkPage, darkFrame] = await look()
      expect(darkFrame).toEqual(darkPage)
      expect(darkFrame.color).not.toBe(frameLook.color)
      expect((await size()).background).toBe(await behind())
      // Still the snippet that was running: its state is where it was left.
      await expect(frame.locator('[data-gauge]')).toHaveText('3 bar')
    })
  })
}
