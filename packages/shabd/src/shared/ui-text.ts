/**
 * The words of the site's own furniture, in English: what is around a page
 * and is not written by its author. A language of the site says them in its
 * own way under `ui:` in the config, by the keys here, and a key it leaves
 * out is said in English.
 *
 * A word in braces is filled in when the sentence is shown: `{version}`.
 *
 * The config is checked against these keys, so a mistyped one is found when
 * the config loads.
 */
export const UI_TEXT = {
  // getting about
  skip: 'Skip to content',
  'region.sidebar': 'Documentation',
  toc: 'On this page',
  'nav.main': 'Main',
  'nav.open': 'Open navigation',
  'nav.close': 'Close navigation',
  breadcrumb: 'Breadcrumb',
  pagination: 'Previous and next page',
  'pagination.previous': 'Previous',
  'pagination.next': 'Next',
  'heading.link': 'Link to this section',
  table: 'Table',
  'notFound.title': 'Page not found',
  'notFound.text': 'No page lives at this address. It may have been moved or renamed. Try the search, or start again from the {home}.',
  'notFound.home': 'home page',

  // a page
  'page.edit': 'Edit this page',
  'page.updated': 'Last updated',
  'page.actions': 'This page for AI assistants',
  'page.copy': 'Copy page',
  'page.copied': 'Copied',
  'page.copyFailed': 'Could not copy',
  'page.markdown': 'View as Markdown',
  'page.openIn': 'Open in {assistant}',
  'code.copy': 'Copy',
  'code.copied': 'Copied',
  'callout.note': 'Note',
  'callout.tip': 'Tip',
  'callout.important': 'Important',
  'callout.warning': 'Warning',
  'callout.caution': 'Caution',

  // search
  search: 'Search',
  'search.dialog': 'Search the documentation',
  'search.field': 'Search the docs',
  'search.close': 'Esc: close search',
  'search.results': 'Results',
  'search.count.one': '1 result',
  'search.count.many': '{count} results',
  'search.none': 'Nothing matches “{query}”. Try other words, or fewer of them.',
  'search.byMeaning': 'Found by meaning: it does not contain your words',
  'search.unavailable': 'Search is unavailable.',
  'search.loading': 'Loading the search index…',
  'search.keyword': 'Searching by keyword.',
  'search.modelLoading': 'Searching by keyword. Loading the language model for search by meaning: {progress}%',
  'search.hybrid': 'Searching by keyword and by meaning. Your query stays on this device.',

  // how the site looks
  'theme.mode': 'Switch colour theme',
  'theme.choose': 'Choose a theme',
  'theme.list': 'Theme',
  'theme.themes': 'Themes',
  'theme.palettes': 'Palettes',

  // versions and languages
  'version.menu': 'Version: {version}',
  'version.old': 'You are reading the documentation for {version}.',
  'version.thisPage': 'Read this page in {version}, the current version.',
  'version.current': 'Go to {version}, the current version.',
  'language.menu': 'Language: {language}',
} as const

export type UiKey = keyof typeof UI_TEXT

/** Says one of the site's own words, with its blanks filled in. */
export type Text = (key: UiKey, values?: Record<string, string | number>) => string

/** The words as one language says them. `words` is what its `ui` gives, and a key it leaves out is said in English. */
export function textOf(words: Record<string, string> | undefined): Text {
  return (key, values) => fill(words?.[key] ?? UI_TEXT[key], values)
}

/** A sentence with its blanks filled in: `{version}` is what `values.version` says. */
export function fill(text: string, values?: Record<string, string | number>): string {
  return values ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole)) : text
}
