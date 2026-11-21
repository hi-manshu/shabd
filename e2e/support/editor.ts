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
