/**
 * The grammar for a page: YAML frontmatter between its dashes, then
 * Markdown, with the code inside a fence read by that fence's own grammar.
 *
 * An .mdx page is read as Markdown too. Its JSX is coloured as the HTML it
 * resembles, and its `import` and `export` lines are not coloured at all:
 * CodeMirror has no MDX grammar.
 */
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from '@codemirror/lang-javascript'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { yamlFrontmatter, yamlLanguage } from '@codemirror/lang-yaml'
import type { Language } from '@codemirror/language'
import type { Extension } from '@codemirror/state'

/**
 * What a fence may name, and the grammar that reads its code. These are the
 * grammars a page and a snippet already bring. Code in any other fence
 * (`sh`, `json`, `css`) is drawn in one colour: each would be another package.
 */
const FENCES = new Map<string, Language>([
  ['js', javascriptLanguage],
  ['javascript', javascriptLanguage],
  ['mjs', javascriptLanguage],
  ['cjs', javascriptLanguage],
  ['jsx', jsxLanguage],
  ['ts', typescriptLanguage],
  ['typescript', typescriptLanguage],
  ['mts', typescriptLanguage],
  ['cts', typescriptLanguage],
  ['tsx', tsxLanguage],
  ['yaml', yamlLanguage],
  ['yml', yamlLanguage],
  ['md', markdownLanguage],
  ['markdown', markdownLanguage],
  ['mdx', markdownLanguage],
])

export const grammar: Extension = yamlFrontmatter({
  content: markdown({
    // GitHub's Markdown: tables, task lists, strikethrough, bare links.
    base: markdownLanguage,
    // `info` is the first word after the backticks: the language, without the fence's other settings.
    codeLanguages: (info) => FENCES.get(info.toLowerCase()) ?? null,
  }),
})
