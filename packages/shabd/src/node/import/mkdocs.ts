/**
 * MkDocs, and Material for MkDocs.
 *
 * The config is YAML and so is the navigation, so nothing has to be run.
 * What differs most from Shabd is the Markdown: callouts (`!!! note`) and
 * tabs (`=== "Tab"`) are blocks whose body is the indented text under them.
 *
 * Not covered: snippets (`--8<--`), macros (`{{ … }}`), icon shortcodes and
 * attribute lists other than heading ids. The first two are reported.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseDocument } from 'yaml'
import { asString, isRecord } from './evaluate.js'
import { convertPage } from './frontmatter.js'
import { firstExisting, isPage, isUrl, listFiles, pathFrom, routeOf, socialName, splitUrl } from './site.js'
import { alert, dropHeadingIds, makeMdxSafe, mapFences, markCode, spaceBlocks, tabs, type Alert, type Line } from './text.js'
import { MESSAGES, type Conversion, type FileNote, type NavItem, type Note, type Relink, type SiteInput, type SourcePage, type SourceSite } from './types.js'

/* ──────────────────────────────── pages ─────────────────────────────── */

const ALERTS: Record<string, Alert> = {
  ...Object.fromEntries(['note', 'info', 'todo', 'abstract', 'summary', 'tldr', 'question', 'help', 'faq', 'example', 'quote', 'cite'].map((type) => [type, 'NOTE'])),
  ...Object.fromEntries(['tip', 'hint', 'success', 'check', 'done'].map((type) => [type, 'TIP'])),
  important: 'IMPORTANT',
  ...Object.fromEntries(['warning', 'caution', 'attention', 'bug'].map((type) => [type, 'WARNING'])),
  ...Object.fromEntries(['danger', 'error', 'failure', 'fail', 'missing'].map((type) => [type, 'CAUTION'])),
}
/** Types that mean what one of Shabd's five means. Any other keeps its name as the title, so "Example" stays an example. */
const PLAIN = new Set(['note', 'info', 'tip', 'hint', 'important', 'warning', 'caution', 'attention', 'danger', 'error'])

const ADMONITION = /^([ \t]*)(!!!|\?\?\?\+?)[ \t]+([\w-]+)((?:[ \t]+[\w-]+)*)(?:[ \t]+(?:"([^"]*)"|'([^']*)'))?[ \t]*$/
const TAB = /^([ \t]*)===\+?[ \t]+(?:"([^"]*)"|'([^']*)')[ \t]*$/

/** Width of a line's indentation, a tab counting as four. */
const indentOf = (text: string) => /^[ \t]*/.exec(text)![0].replace(/\t/g, '    ').length
const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/**
 * The lines under `lines[start]` that belong to it: indented four columns
 * further, with the empty lines between them. Returned without that
 * indentation, and with code marked afresh.
 */
function bodyOf(lines: Line[], start: number, indent: number): { body: Line[]; next: number } {
  let end = start + 1
  let last = start
  while (end < lines.length && (lines[end]!.text.trim() === '' || indentOf(lines[end]!.text) >= indent + 4)) {
    if (lines[end]!.text.trim() !== '') last = end
    end++
  }
  const body = lines.slice(start + 1, last + 1).map(({ text, number }) => ({
    text: text.replace(/\t/g, '    ').slice(Math.min(indent + 4, indentOf(text))),
    number,
  }))
  return { body: markCode(body), next: last + 1 }
}

/** Callouts and tabs, innermost first. */
function convertBlocks(lines: Line[], notes: Note[]): Line[] {
  const out: Line[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    const admonition = line.code ? null : ADMONITION.exec(line.text)
    const tab = line.code ? null : TAB.exec(line.text)

    if (admonition) {
      const [, indent = '', marker = '', type = '', , double, single] = admonition
      const { body, next } = bodyOf(lines, index, indentOf(indent))
      const name = type.toLowerCase()
      const given = double ?? single
      const title = given ?? (PLAIN.has(name) ? undefined : capitalise(name.replace(/[-_]/g, ' ')))
      out.push(...alert(ALERTS[name] ?? 'NOTE', title, convertBlocks(body, notes), line, indent))
      notes.push({ kind: 'converted', what: 'callout', line: line.number })
      if (marker !== '!!!') notes.push({ kind: 'manual', message: MESSAGES.collapsible, line: line.number })
      index = next
    } else if (tab) {
      const indent = tab[1]!
      const items: { label: string; body: Line[] }[] = []
      // Tabs that follow each other, with nothing but empty lines between, are one set.
      for (;;) {
        const header = TAB.exec(lines[index]?.text ?? '')
        if (!header || lines[index]!.code || header[1] !== indent) break
        const { body, next } = bodyOf(lines, index, indentOf(indent))
        items.push({ label: header[2] ?? header[3] ?? '', body: convertBlocks(body, notes) })
        index = next
        let ahead = index
        while (ahead < lines.length && lines[ahead]!.text.trim() === '') ahead++
        if (TAB.test(lines[ahead]?.text ?? '')) index = ahead
      }
      out.push(...tabs(items, line, indent))
      notes.push({ kind: 'converted', what: 'tab group', line: line.number })
    } else {
      out.push(line)
      index++
    }
  }
  return out
}

/**
 * The options of a code fence. MkDocs writes them as attributes:
 * `python title="a.py" linenums="1" hl_lines="2 3"`, or the whole of it
 * in braces with the language as a class. Returns undefined for a fence
 * that already reads the same in Shabd.
 */
export function mkdocsFence(info: string): string | undefined {
  const braced = /^\{(.*)\}$/.exec(info)
  if (!braced && !/\b(?:linenums|hl_lines)=/.test(info)) return undefined
  const text = braced ? braced[1]! : info
  const language = braced ? (/(?:^|\s)\.([\w+#-]+)/.exec(text)?.[1] ?? '') : (/^[^\s=]+(?=\s|$)/.exec(text)?.[0] ?? '')
  const options: string[] = []
  for (const [, key, double, single] of text.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)) {
    const value = double ?? single ?? ''
    if (key === 'linenums') options.push('showLineNumbers')
    else if (key === 'hl_lines') options.push(`{${value.trim().split(/\s+/).join(',')}}`)
    else options.push(`${key}="${value}"`)
  }
  return [language, ...options].filter(Boolean).join(' ')
}

export function convertMkdocsPage(source: string, options: { links?: Relink | undefined } = {}): Conversion {
  return convertPage(source, {
    frontmatter(frontmatter) {
      const hide = frontmatter.get('hide')
      if (Array.isArray(hide)) {
        if (hide.includes('navigation')) frontmatter.set('sidebar', false)
        if (hide.includes('toc')) frontmatter.set('toc', false)
        // What Material calls the footer of a page is its previous and next links.
        if (hide.includes('footer')) frontmatter.set('pagination', false)
        frontmatter.delete('hide')
        frontmatter.converted++
      }
      const status = frontmatter.get('status')
      if (status === 'new' || status === 'deprecated') {
        frontmatter.delete('status')
        frontmatter.setSidebar('badge', capitalise(status))
        frontmatter.converted++
      }
      const template = asString(frontmatter.get('template'))
      if (template) frontmatter.manual.push({ key: 'template', message: `The page uses the template ${template}, which Shabd has no counterpart for.` })
    },
    body(lines, notes) {
      // Tabs are a component, and a page with a component is MDX. The rest of the page has to read as MDX too.
      const mdx = lines.some((line) => !line.code && TAB.test(line.text))
      let out = options.links ? options.links(lines, notes) : lines
      for (const line of lines) {
        if (line.code) continue
        if (/--8<--/.test(line.text)) notes.push({ kind: 'manual', message: 'A snippet (`--8<--`) is not included by Shabd. Paste the text in.', line: line.number })
        else if (/\{\{.*\}\}|\{%.*%\}/.test(line.text)) notes.push({ kind: 'manual', message: 'A macro is written out as it is: Shabd does not run macros.', line: line.number })
      }
      out = dropHeadingIds(out, notes)
      if (mdx) {
        const safe = makeMdxSafe(out)
        out = safe.lines
        for (let count = 0; count < safe.comments; count++) notes.push({ kind: 'converted', what: 'comment' })
      }
      out = convertBlocks(markCode(out), notes)
      out = mapFences(markCode(out), (info, line) => {
        const changed = mkdocsFence(info)
        if (changed !== undefined) notes.push({ kind: 'converted', what: 'code fence', line: line.number })
        return changed
      })
      return { lines: spaceBlocks(out), mdx }
    },
  })
}

/* ───────────────────────────── navigation ───────────────────────────── */

/**
 * `nav:` as MkDocs writes it: a page (`guide.md`), a titled page
 * (`Guide: guide.md`), a titled link, or a section (`Guide: [ … ]`).
 * `pages` maps a file of the source to its id in the new site.
 */
export function mkdocsNav(nav: unknown, pages: ReadonlyMap<string, string>): { items: NavItem[]; unknown: string[] } {
  const unknown: string[] = []
  const target = (ref: string, label?: string): NavItem | undefined => {
    const id = pages.get(ref.replace(/^\.?\/+/, ''))
    if (id !== undefined) return { type: 'page', id, label }
    if (/^[a-z][a-z0-9+.-]*:|^\//i.test(ref)) return { type: 'link', href: ref, label: label ?? ref }
    unknown.push(ref)
    return undefined
  }
  const read = (entries: unknown): NavItem[] =>
    (Array.isArray(entries) ? entries : []).flatMap((entry): NavItem[] => {
      if (typeof entry === 'string') return [target(entry)].flatMap((item) => item ?? [])
      if (!isRecord(entry)) return []
      return Object.entries(entry).flatMap(([label, value]): NavItem[] => {
        if (typeof value === 'string') return [target(value, label)].flatMap((item) => item ?? [])
        return Array.isArray(value) ? [{ type: 'group', label, items: read(value) }] : []
      })
    })
  return { items: read(nav), unknown }
}

/* ──────────────────────────────── site ──────────────────────────────── */

export async function readMkdocs(root: string): Promise<SourceSite> {
  const configFile = firstExisting(root, ['mkdocs.yml', 'mkdocs.yaml'])
  const notes: FileNote[] = []
  let config: Record<string, unknown> = {}
  if (configFile) {
    // MkDocs configs name Python objects with tags of their own (`!!python/name:…`). They are not needed here.
    const doc = parseDocument(await readFile(configFile, 'utf8'), { merge: true, logLevel: 'silent' })
    const data = doc.errors.length === 0 ? (doc.toJS() as unknown) : undefined
    if (isRecord(data)) config = data
    else notes.push({ file: path.basename(configFile), line: doc.errors[0]?.linePos?.[0].line, message: 'The config is not YAML that could be read, so the title and the navigation were not taken from it.' })
  }

  const contentDir = path.resolve(root, asString(config.docs_dir) ?? 'docs')
  const files = await listFiles(contentDir)
  const present = new Set(files)
  const pages: SourcePage[] = files.filter(isPage).map((source) => {
    // MkDocs takes README.md as a folder's first page where there is no index.md.
    const readme = /(^|\/)README\.md$/i.exec(source)
    const id = readme && !present.has(`${source.slice(0, readme.index)}${readme[1]}index.md`) ? `${source.slice(0, readme.index)}${readme[1]}index.md` : source
    return { source, id, route: routeOf(id) }
  })

  const theme = isRecord(config.theme) ? config.theme : {}
  const site: SiteInput = {
    title: asString(config.site_name) ?? path.basename(root),
    description: asString(config.site_description),
    ...splitUrl(config.site_url),
    lang: asString(theme.language),
    repo: isUrl(config.repo_url) ? config.repo_url : undefined,
    footer: asString(config.copyright),
  }
  const social: Record<string, string> = {}
  const extra = isRecord(config.extra) ? config.extra : {}
  for (const link of Array.isArray(extra.social) ? extra.social : []) {
    if (isRecord(link) && isUrl(link.link)) social[socialName(asString(link.icon) ?? asString(link.name) ?? 'link')] = link.link
  }
  if (isUrl(config.repo_url) && /github\.com/.test(config.repo_url)) social.github ??= config.repo_url
  site.social = social

  // The logo and the icon are files among the pages. Shabd looks for both in public/.
  const publicFiles: { from: string; to: string }[] = []
  for (const key of ['logo', 'favicon'] as const) {
    const file = asString(theme[key])
    if (!file || !present.has(file)) continue
    publicFiles.push({ from: path.join(contentDir, file), to: path.posix.basename(file) })
    site[key] = `/${path.posix.basename(file)}`
  }

  let nav: NavItem[] | undefined
  let navSource = 'The source lists no navigation, so Shabd generates the sidebar from the folders, as MkDocs did.'
  if (Array.isArray(config.nav)) {
    const read = mkdocsNav(config.nav, new Map(pages.map((page) => [page.source, page.id])))
    nav = read.items
    navSource = `From \`nav:\` in ${path.basename(configFile!)}.`
    for (const ref of read.unknown) notes.push({ file: path.basename(configFile!), message: `\`nav:\` lists ${ref}, which is not a page in ${pathFrom(root, contentDir) || '.'}. It was left out.` })
  }
  if (Array.isArray(config.plugins) && config.plugins.some((plugin) => plugin !== 'search' && !(isRecord(plugin) && 'search' in plugin))) {
    notes.push({ file: path.basename(configFile!), message: 'The site uses MkDocs plugins. What they add to pages is not imported.' })
  }

  return {
    tool: 'mkdocs',
    contentDir,
    pages,
    publicDirs: [],
    publicFiles,
    site,
    nav,
    navSource,
    // MkDocs links to pages by file, as Shabd does.
    links: { relative: 'file', prefixes: [] },
    notes,
    convert: (text, _page, links) => convertMkdocsPage(text, { links }),
  }
}
