/**
 * The code editor, as the tests reach it: by its role and its name, the way
 * a screen reader does, and not by how it happens to be built.
 */
import type { Locator } from '@playwright/test'

/** The editor of a live sandbox: the text field that holds its snippet. */
export const snippetEditor = (sandbox: Locator): Locator => sandbox.getByRole('textbox', { name: /^Code for this example/ })

/**
 * What an editor shows, line for line. The editor draws only the lines near
 * the ones in view; the snippets these tests edit are short enough to be
 * drawn whole.
 */
export const editorText = (editor: Locator): Promise<string> =>
  editor
    .locator('.cm-line')
    .allTextContents()
    .then((lines) => lines.join('\n'))

/**
 * What a page wrote to the console, without one warning of Firefox's.
 *
 * On a page that has both a code editor and the frame of an isolated snippet,
 * Firefox now and then says of the frame: "Layout was forced before the page
 * was fully loaded". It is a warning that a page may be drawn before its
 * styles are in. The frame is not shown until its snippet is, and nothing was
 * seen to be wrong with one. It began when the sandbox's text area became the
 * code editor, it comes in some runs and not in others, and what asks for the
 * layout was looked for and not found: not the frame's own script, which was
 * tried both starting later and measuring later.
 */
export const said = (problems: string[]): string[] => problems.filter((text) => !text.includes('Layout was forced before the page was fully loaded'))
