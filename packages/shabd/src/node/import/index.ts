/**
 * `shabd import`: turns a site made with Docusaurus, VitePress, Starlight
 * or MkDocs into a Shabd site.
 *
 *   1. Tell which tool made the source, from the config file it has.
 *   2. Let that tool's module read the config: where the pages are, the
 *      site's title and links, the navigation.
 *   3. Convert each page: frontmatter, callouts, tabs, code fences, links.
 *   4. Write the new site: shabd.config.yaml, sidebar.yaml, content/ and
 *      public/, with a package.json to run it.
 *   5. Run Shabd's own check over what was written.
 *
 * The source is only read. The result says what was converted and lists
 * what was not, so that nothing is lost without the author knowing.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import pc from 'picocolors'
import { stringify } from 'yaml'
import { fileToSlug } from '../../shared/paths.js'
import { collectProblems, formatProblem, type Problem } from '../check.js'
import { isShabdError } from '../config/errors.js'
import { createContext } from '../context.js'
import { PACKAGE_ROOT, packageName, packageVersion } from '../paths.js'
import { readDocusaurus } from './docusaurus.js'
import { rewriteLinks } from './links.js'
import { readMkdocs } from './mkdocs.js'
import { firstExisting, indexPages, listFiles, pathFrom, sameAddress, titleOf, toSidebar, writeConfig, writeSidebar } from './site.js'
import { ASTRO_CONFIG_FILES, readStarlight } from './starlight.js'
import { SOURCE_TOOLS, TOOL_NAMES, type Converted, type FileNote, type NavItem, type SourceSite, type SourceTool } from './types.js'
import { readVitepress, vitepressRoot } from './vitepress.js'

const { posix } = path

/** Something the person running the command can put right. The message says how. */
export class ImportError extends Error {
  override readonly name = 'ImportError'
}

const READERS: Record<SourceTool, (root: string) => Promise<SourceSite>> = {
  docusaurus: readDocusaurus,
  vitepress: readVitepress,
  starlight: readStarlight,
  mkdocs: readMkdocs,
}

/** The tools whose config is in `root`. More than one is possible: a repository may hold two sites. */
export function detectTools(root: string): SourceTool[] {
  const astro = firstExisting(root, ASTRO_CONFIG_FILES)
  const found: Record<SourceTool, boolean> = {
    docusaurus: firstExisting(root, ['ts', 'mts', 'js', 'mjs', 'cjs'].map((extension) => `docusaurus.config.${extension}`)) !== undefined,
    vitepress: vitepressRoot(root) !== undefined,
    // Astro builds many kinds of site. Only one that uses Starlight is documentation this can read.
    starlight: astro !== undefined && /starlight/.test(readFileSync(astro, 'utf8')),
    mkdocs: firstExisting(root, ['mkdocs.yml', 'mkdocs.yaml']) !== undefined,
  }
  return SOURCE_TOOLS.filter((tool) => found[tool])
}

function chooseTool(root: string, from: string | undefined): SourceTool {
  if (from !== undefined) {
    const tool = SOURCE_TOOLS.find((name) => name === from.toLowerCase())
    if (!tool) throw new ImportError(`--from must be one of ${SOURCE_TOOLS.join(', ')}, got "${from}"`)
    return tool
  }
  const found = detectTools(root)
  if (found.length === 1) return found[0]!
  if (found.length > 1) {
    throw new ImportError(`${root} holds the config of more than one tool (${found.join(', ')}). Say which site to import with --from.`)
  }
  throw new ImportError(
    `Could not tell which tool made the site in ${root}.\n` +
      `Looked for docusaurus.config.*, .vitepress/config.*, an astro.config.* that uses Starlight, and mkdocs.yml.\n` +
      `Give the folder that holds one of them, or name the tool with --from.`,
  )
}

export interface ImportOptions {
  /** The folder to write. By default the source's name with `-shabd` after it, beside the source. */
  out?: string | undefined
  /** The tool that made the source, when it should not be worked out from the files. */
  from?: string | undefined
  /** Write into a folder that is not empty. Files the import writes replace the ones there. */
  force?: boolean | undefined
}

export interface ImportResult {
  tool: SourceTool
  source: string
  out: string
  /** Pages written. */
  pages: number
  /** How many of them were .md in the source and are .mdx now. */
  renamed: number
  /** Other files copied: pictures beside the pages, and what is served from public/. */
  files: number
  /** How many of each kind of thing were converted. */
  converted: Partial<Record<Converted, number>>
  /** In one sentence, where the sidebar came from or why it has no entries. */
  navigation: string
  /** Things done that the source did not ask for, such as a home page where it had none. */
  remarks: string[]
  /** What needs a hand. `file` is relative to the new site, or to the source when `source` is set. */
  manual: (FileNote & { source?: boolean })[]
  /** What Shabd's own check says about the new site. `refused` holds errors that come with a code frame. */
  check: { pages: number; problems: Problem[]; refused: string[] }
}

/** A `.git` folder is no reason to refuse: `git init` may have been run first. */
const HARMLESS = new Set(['.git', '.DS_Store'])

const isInside = (child: string, parent: string) => {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** The first page the navigation leads to. */
function firstPage(nav: NavItem[]): string | undefined {
  for (const item of nav) {
    const id = item.type === 'page' ? item.id : item.type === 'group' ? firstPage(item.items) : undefined
    if (id !== undefined) return id
  }
  return undefined
}

export async function importSite(sourceDir: string, options: ImportOptions = {}): Promise<ImportResult> {
  const source = path.resolve(sourceDir)
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new ImportError(`${source} is not a folder. Give the folder of the site to import.`)
  }
  const tool = chooseTool(source, options.from)
  const out = path.resolve(options.out ?? `${source}-shabd`)
  if (isInside(out, source) || isInside(source, out)) {
    throw new ImportError(`${out} is inside the site being imported, or holds it. The source is never written to: choose a folder beside it with --out.`)
  }
  const existing = existsSync(out) ? (await readdir(out)).filter((name) => !HARMLESS.has(name)) : []
  if (existing.length > 0 && !options.force) {
    throw new ImportError(
      `${out} is not empty (it has ${existing.slice(0, 3).join(', ')}${existing.length > 3 ? ', …' : ''}).\n` +
        `Choose another folder with --out, or pass --force to write into it. Pages and the two YAML files replace the ones there.`,
    )
  }

  const site = await READERS[tool](source)
  if (site.pages.length === 0) {
    throw new ImportError(`No pages were found in ${site.contentDir}. Is ${source} the folder of a ${TOOL_NAMES[tool]} site?`)
  }

  const manual: ImportResult['manual'] = site.notes.map((note) => ({ ...note, source: true }))
  const converted: ImportResult['converted'] = {}
  const remarks: string[] = []
  /** Everything to write: path in the new site → its text, or the file to copy there. */
  const texts = new Map<string, string>()
  const copies = new Map<string, string>()

  /* ── where files go ── */

  const { byFile, byRoute } = indexPages(site.pages)
  const contentFiles = await listFiles(site.contentDir)
  const pageSources = new Set(site.pages.map((page) => page.source))
  const publicDirs = site.publicDirs.filter((dir) => existsSync(dir))
  const place = site.place ?? ((file: string) => file)

  for (const file of contentFiles) {
    const target = pageSources.has(file) ? undefined : place(file)
    if (target !== undefined) copies.set(posix.join('content', target), path.join(site.contentDir, file))
  }
  for (const dir of publicDirs) {
    for (const file of await listFiles(dir)) copies.set(posix.join('public', file), path.join(dir, file))
  }

  /**
   * Where the file a page names will be in the new site. A picture among the
   * pages moves with them. One that the source serves from its root is in
   * public/. Any other file of the project is copied to assets/.
   */
  const placed = (file: string): string | undefined => {
    const absolute = path.resolve(site.contentDir, file)
    if (!existsSync(absolute) || !statSync(absolute).isFile() || !isInside(absolute, source)) return undefined
    const served = publicDirs.find((dir) => isInside(absolute, dir))
    if (served) return posix.join('public', pathFrom(served, absolute))
    if (isInside(absolute, site.contentDir)) {
      const target = place(pathFrom(site.contentDir, absolute))
      return target === undefined ? undefined : posix.join('content', target)
    }
    const target = posix.join('assets', pathFrom(source, absolute).replace(/^src\//, '').replace(/^assets\//, ''))
    copies.set(target, absolute)
    return target
  }

  /* ── pages ── */

  const titles = new Map<string, string>()
  const ids: string[] = []
  let renamed = 0
  for (const page of site.pages) {
    const text = await readFile(path.join(site.contentDir, page.source), 'utf8')
    const conversion = site.convert(text, page, (lines, notes) =>
      rewriteLinks(lines, { rules: site.links, page, byFile, byRoute, placed }, notes),
    )
    const extension = (file: string) => (conversion.mdx ? file.replace(/\.md$/i, '.mdx') : file)
    let id = extension(page.id)
    if (texts.has(posix.join('content', id))) {
      // Two files of the source that would get one name here, such as index.md beside README.md. Neither is lost.
      manual.push({ file: posix.join('content', extension(page.source)), message: `Would be written over content/${id}, so it keeps the name it had in the source.` })
      id = extension(page.source)
    }
    if (conversion.mdx && !/\.mdx$/i.test(page.source)) renamed++
    ids.push(id)
    texts.set(posix.join('content', id), conversion.text)
    const title = titleOf(conversion.text, id.endsWith('.mdx') ? 'mdx' : 'md')
    if (title) titles.set(page.id, title)
    for (const note of conversion.notes) {
      if (note.kind === 'converted') converted[note.what] = (converted[note.what] ?? 0) + 1
      else manual.push({ file: posix.join('content', id), line: note.line, message: note.message })
    }
  }
  for (const [first, second] of sameAddress(ids)) {
    manual.push({ file: posix.join('content', second), message: `Has the same address as content/${first}. Shabd refuses both until one is renamed or removed.` })
  }

  // A site whose first page is not at `/` would open on "page not found".
  if (!ids.some((id) => fileToSlug(id) === '')) {
    const first = (site.nav ? firstPage(site.nav) : undefined) ?? [...site.pages].sort((a, b) => (a.id < b.id ? -1 : 1))[0]!.id
    const hero = {
      title: site.site.title,
      ...(site.site.description ? { tagline: site.site.description } : {}),
      actions: [{ label: titles.get(first) ?? 'Read the documentation', link: `/${fileToSlug(first)}` }],
    }
    texts.set('content/index.md', `---\n${stringify({ title: site.site.title, layout: 'splash', hero }, { lineWidth: 0 })}---\n`)
    remarks.push('The source has no page at the root of the site, so content/index.md was written: a title and a link to the first page.')
  }

  /* ── the two YAML files, and what a site needs to run ── */

  const config = writeConfig(site.site, TOOL_NAMES[tool])
  texts.set('shabd.config.yaml', config.text)
  for (const key of config.dropped) {
    manual.push({ file: 'shabd.config.yaml', message: `\`${key}\` in the source holds something Shabd does not accept there, and was left out.` })
  }
  texts.set('sidebar.yaml', writeSidebar(site.nav ? toSidebar(site.nav, titles) : [], site.navSource))
  for (const file of site.publicFiles ?? []) copies.set(posix.join('public', file.to), file.from)

  const shabd = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { peerDependencies?: Record<string, string> }
  const peers = Object.fromEntries(['react', 'react-dom'].map((name) => [name, shabd.peerDependencies?.[name] ?? '*']))
  const manifest = {
    name: path.basename(out).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '') || 'docs',
    private: true,
    type: 'module',
    scripts: { dev: 'shabd dev', build: 'shabd build', preview: 'shabd preview', check: 'shabd check' },
    dependencies: { ...peers, [packageName()]: `^${packageVersion()}` },
  }
  // Neither comes from the source, so one that is already there is the author's own.
  if (!existsSync(path.join(out, 'package.json'))) texts.set('package.json', `${JSON.stringify(manifest, null, 2)}\n`)
  if (!existsSync(path.join(out, '.gitignore'))) texts.set('.gitignore', 'node_modules/\ndist/\n.shabd/\n')

  /* ── write ── */

  for (const [file, from] of copies) {
    if (texts.has(file)) continue
    const target = path.join(out, file)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(from, target)
  }
  for (const [file, text] of texts) {
    const target = path.join(out, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, text)
  }

  /* ── Shabd's own check ── */

  let check: ImportResult['check']
  try {
    const context = await createContext(out, { dev: false })
    const { problems, detailed } = await collectProblems(context)
    await context.compiler.cache.flush()
    check = { pages: context.store.pages().length, problems, refused: detailed.map((error) => error.pretty(out)) }
  } catch (error) {
    if (!isShabdError(error)) throw error
    check = { pages: 0, problems: [], refused: [error.pretty(out)] }
  }

  return {
    tool,
    source,
    out,
    pages: ids.length,
    renamed,
    files: [...copies.keys()].filter((file) => !texts.has(file)).length,
    converted,
    navigation: site.navSource,
    remarks,
    manual,
    check,
  }
}

/** True when Shabd would not build the new site as it is. */
export function hasErrors(result: ImportResult): boolean {
  return result.check.refused.length > 0 || result.check.problems.some((problem) => problem.level === 'error')
}

const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`

/** The report printed when an import is done. */
export function formatReport(result: ImportResult, cwd = process.cwd()): string {
  const below = path.relative(cwd, result.out) || '.'
  const shown = below.startsWith('..') ? result.out : below
  const lines = [`\nImported a ${TOOL_NAMES[result.tool]} site into ${pc.bold(shown)}\n`]

  const mdx = result.renamed > 0 ? ` (${result.renamed} written as .mdx, because ${result.renamed === 1 ? 'it uses' : 'they use'} a component)` : ''
  lines.push(`  ${pc.bold('Copied')}      ${count(result.pages, 'page')}${mdx}, ${count(result.files, 'other file')}`)
  const kinds = Object.entries(result.converted).map(([what, n]) => count(n, what))
  lines.push(`  ${pc.bold('Converted')}   ${kinds.length ? kinds.join(', ') : 'nothing needed converting'}`)
  lines.push(`  ${pc.bold('Navigation')}  ${result.navigation}`)
  for (const remark of result.remarks) lines.push(`  ${pc.bold('Added')}       ${remark}`)

  // One entry for each thing that needs a hand, with every place it applies to under it.
  const byMessage = new Map<string, Map<string, number[]>>()
  for (const note of result.manual) {
    const files = byMessage.get(note.message) ?? new Map<string, number[]>()
    byMessage.set(note.message, files)
    const file = note.source ? `${note.file} (in the source)` : note.file
    files.set(file, [...(files.get(file) ?? []), ...(note.line !== undefined ? [note.line] : [])])
  }
  if (byMessage.size > 0) {
    lines.push(`\n${pc.bold(`Needs a hand (${count(result.manual.length, 'place')})`)}`)
    for (const [message, files] of byMessage) {
      lines.push(`\n  ${message}`)
      for (const [file, numbers] of files) {
        lines.push(`    ${pc.cyan(numbers.length ? `${file}:${[...new Set(numbers)].sort((a, b) => a - b).join(', ')}` : file)}`)
      }
    }
  }

  const { pages, problems, refused } = result.check
  lines.push(`\n${pc.bold('What `shabd check` says about the new site')}`)
  for (const error of refused) lines.push(`\n${error}`)
  if (problems.length) lines.push(`\n${problems.map(formatProblem).join('\n')}`)
  const errors = refused.length + problems.filter((problem) => problem.level === 'error').length
  const warnings = problems.filter((problem) => problem.level === 'warning').length
  lines.push(
    errors || warnings
      ? `\n  ${count(pages, 'page')} checked: ${count(errors, 'error')}, ${count(warnings, 'warning')}`
      : `\n  ${pc.green('✓')} ${count(pages, 'page')} checked, no problems found`,
  )

  lines.push(`\n${pc.bold('Next')}\n`)
  if (shown !== '.') lines.push(`  cd ${shown}`)
  lines.push('  npm install', '  npm run dev\n')
  return lines.join('\n')
}
