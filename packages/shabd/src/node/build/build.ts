/**
 * `shabd build`: a static site in dist/.
 *
 *   1. bundle     Vite builds the browser app; each page becomes its own chunk
 *   2. prerender  Vite builds a server bundle, which renders every route to HTML
 *   3. extras     llms.txt, per-page Markdown, the search index, MCP data, sitemap
 *   4. adapter    with `--adapter`, what one host needs beyond the files (src/node/adapters)
 *
 * The first three steps share one context, so each page is compiled once (or
 * not at all, if the on-disk cache already holds it).
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import pc from 'picocolors'
import { build as viteBuild } from 'vite'
import type { AdapterName } from '../../shared/adapters.js'
import { pageFile, siteHref, withBase } from '../../shared/paths.js'
import { SEARCH_FILES } from '../../shared/search-core.js'
import type { RenderedPage } from '../../shared/types.js'
import { chooseAdapter, type MovedAddress } from '../adapters/index.js'
import { collectProblems, formatProblem } from '../check.js'
import { themePaletteCss } from '../config/theme-css.js'
import { compilePage, createContext, type ShabdContext } from '../context.js'
import { markdownPath, pageAddress, publicUrl, renderLlmsFull, renderLlmsTxt } from '../llms/llms-txt.js'
import { pageMarkdown } from '../llms/markdown.js'
import { DOCS_FILE, SEARCH_INDEX_FILE, SEARCH_VECTORS_FILE, type DocsFile } from '../mcp/source.js'
import { modelFiles, runtimeFiles } from '../search/model-files.js'
import { SearchService } from '../search/service.js'
import { generateSocialImages } from '../social/index.js'
import { themedCodeCss } from '../markdown/plugins/rehype-code.js'
import { serverOutDir, shabd } from '../vite/plugin.js'
import { FEED_FILE, feedEntries, renderFeed } from './feed.js'
import { escapeHtml, renderDocument, renderRedirect } from './html.js'
import { OFFLINE_PAGE, SERVICE_WORKER_FILE, offlineBody, offlineFiles, serviceWorker } from './offline.js'
import { renderRobots, renderSitemap, wantsRobots } from './robots.js'

export interface BuildOptions {
  /** Set false to skip embeddings and ship keyword search only. */
  semantic?: boolean
  /** The host to write for, as `shabd build --adapter` takes it. Wins over `build.adapter` in the config. */
  adapter?: AdapterName | undefined
}

/** One entry of Vite's build manifest. */
interface ManifestChunk {
  file: string
  src?: string
  isEntry?: boolean
  imports?: string[]
  /** What the chunk loads on demand, by key. */
  dynamicImports?: string[]
  css?: string[]
  /** Fonts, pictures and workers the chunk names. */
  assets?: string[]
}
type Manifest = Record<string, ManifestChunk>

const step = (message: string) => console.log(`  ${pc.green('✓')} ${message}`)
const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`

export async function build(root: string, options: BuildOptions = {}): Promise<void> {
  const started = performance.now()
  const context = await createContext(root, { dev: false })
  const { config, store, compiler } = context
  // First, so that a name that is not an adapter stops the build before it has done any work.
  const adapter = chooseAdapter(options.adapter, config)
  const outDir = path.join(config.root, 'dist')
  const pages = store.pages()

  console.log(`\n${pc.bold('shabd build')} ${pc.dim(path.relative(process.cwd(), config.root) || '.')}\n`)

  // Problems in content stop the build before any time is spent bundling.
  const { problems, detailed } = await collectProblems(context)
  if (detailed.length) throw detailed[0]
  step(`${pages.length} pages compiled`)
  if (store.lastUpdatedNote) {
    console.log(pc.yellow(`    defaults.lastUpdated is on, but ${store.lastUpdatedNote}. No page shows when it was last changed.`))
  }

  const viteOptions = { configFile: false as const, root: config.root, logLevel: 'warn' as const }
  let phase = performance.now()
  await viteBuild({ ...viteOptions, plugins: [shabd({ context })] })
  step(`browser bundle ${pc.dim(seconds(performance.now() - phase))}`)

  const write = async (file: string, contents: string | Uint8Array) => {
    const target = path.join(outDir, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, contents)
  }

  // The picture for each page, before the pages are written: each page names its own in its head.
  let pictures = new Map<string, string>()
  if (config.config.features.socialImages.enabled) {
    phase = performance.now()
    const social = await generateSocialImages(context, write)
    pictures = social.images
    if (social.reason) console.log(pc.yellow(`    features.socialImages is on, but ${social.reason}.`))
    else step(`${pictures.size} social pictures, ${social.drawn} newly drawn ${pc.dim(seconds(performance.now() - phase))}`)
  }

  phase = performance.now()
  await viteBuild({ ...viteOptions, plugins: [shabd({ context })], build: { ssr: true } })
  const serverDir = serverOutDir(config)
  const { render } = (await import(pathToFileURL(path.join(serverDir, 'entry-server.mjs')).href)) as {
    render(path: string): Promise<RenderedPage>
  }
  const manifest = JSON.parse(await readFile(path.join(outDir, '.vite', 'manifest.json'), 'utf8')) as Manifest
  const assets = new AssetResolver(manifest, context)

  // The presets in the theme menu are the same on every page. They go in one
  // file, named after its contents so that it can be cached for good.
  const named = (name: string, css: string) => `_shabd/${name}.${createHash('sha1').update(css).digest('hex').slice(0, 8)}.css`
  const paletteCss = themePaletteCss(config.config.theme)
  const paletteFile = paletteCss ? named('palettes', paletteCss) : undefined
  if (paletteFile) await write(paletteFile, paletteCss)

  // So do the colours of code under the syntax themes those presets bring. A page carries the colours of
  // its own code in the site's two themes, which every reader needs. The rest is for a reader who picks
  // a preset, and is fetched then: every token class of every page, once, in one file.
  const themed: Record<string, string[]> = {}
  if (compiler.highlighter.keys.length > 2) {
    for (const page of pages) Object.assign(themed, (await compilePage(context, page)).codeColours)
  }
  const codeCss = themedCodeCss(compiler.highlighter.keys, themed)
  const codeFile = codeCss ? named('code-themes', codeCss) : undefined
  if (codeFile) await write(codeFile, codeCss)

  const renderRoute = async (routePath: string, sourceFile?: string) => {
    const rendered = await render(routePath)
    return renderDocument({
      config: config.config,
      title: rendered.title,
      description: rendered.description,
      path: routePath,
      // The page for an address that does not exist is not one to list either.
      noindex: sourceFile === undefined || store.byPath(routePath)?.frontmatter.noindex,
      // A page's own picture, then the one drawn for it. With neither, the document falls back to the site's.
      image: store.byPath(routePath)?.frontmatter.image ?? pictures.get(routePath),
      body: rendered.html,
      head: assets.headTags(sourceFile),
      scripts: assets.entryScript(),
      ...(paletteFile ? { paletteStylesheet: withBase(config.config.site.base, `/${paletteFile}`) } : {}),
      ...(codeFile ? { codeStylesheet: withBase(config.config.site.base, `/${codeFile}`) } : {}),
    })
  }

  /** The file a static host serves for a route. Which file that is follows from `site.urls`. */
  const routeFile = (routePath: string) => pageFile(routePath, config.config.site.urls)

  for (const page of pages) {
    const html = await renderRoute(page.path, page.file)
    await write(routeFile(page.path), html)
  }
  // Static hosts serve 404.html for unknown URLs. A `content/404.md` page customises it.
  const custom404 = store.byPath('/404')
  await write('404.html', await renderRoute('/404', custom404?.file))
  // Intermediates: the prerender bundle, and the manifest the tags above were read from.
  await rm(serverDir, { recursive: true, force: true })
  await rm(path.join(outDir, '.vite'), { recursive: true, force: true })
  step(`${pages.length} pages prerendered ${pc.dim(seconds(performance.now() - phase))}`)

  // An address that has moved gets a page that sends the reader on. A page that exists keeps its address:
  // the redirect over it is reported with the other problems.
  const redirects = config.redirects.filter((redirect) => !store.byPath(redirect.from))
  const moved: MovedAddress[] = redirects.map((redirect) => ({
    from: redirect.from,
    to: siteHref(redirect.to, config.config.site, (route) => store.byPath(route) !== undefined),
  }))
  // The pages are written with an adapter too: they are what answers where the host's own rule does not.
  for (const { from, to } of moved) await write(routeFile(from), renderRedirect(config.config, to))
  if (redirects.length) step(`${redirects.length} ${redirects.length === 1 ? 'redirect' : 'redirects'}`)

  /* ── for AI agents ── */

  const { features, site } = config.config
  if (features.llms.enabled) {
    await write('llms.txt', renderLlmsTxt(context))
    if (features.llms.full) await write('llms-full.txt', renderLlmsFull(context))
    for (const page of pages) await write(markdownPath(page.path).slice(1), pageMarkdown(page))
    step(`llms.txt${features.llms.full ? ', llms-full.txt' : ''} and ${pages.length} Markdown copies`)
    if (!site.url) {
      console.log(pc.yellow('    site.url is not set, so links in llms.txt are relative. Set it to the deployed address.'))
    }
  }

  if (features.mcp.enabled) {
    const docs: DocsFile = {
      version: 1,
      name: site.title,
      description: site.description,
      pages: pages.map((page) => ({
        path: page.path,
        title: page.title,
        description: page.description,
        url: publicUrl(context, markdownPath(page.path)),
        markdown: pageMarkdown(page),
      })),
    }
    await write(DOCS_FILE, JSON.stringify(docs))
  }

  /* ── search ── */

  if (features.search.enabled || features.mcp.enabled) {
    phase = performance.now()
    const search = new SearchService(() => context, {
      ...(options.semantic === false ? { semantic: false } : {}),
      log: (message) => console.log(pc.yellow(`    ${message}`)),
    })
    const index = await search.index()
    await write(SEARCH_INDEX_FILE, JSON.stringify(index.file))
    if (index.vectors) {
      const { buffer, byteOffset, byteLength } = index.vectors
      await write(SEARCH_VECTORS_FILE, new Uint8Array(buffer, byteOffset, byteLength))
    }
    const kind = index.file.semantic
      ? `semantic, ${index.file.semantic.dims} dimensions, ${index.stats.embedded} newly embedded`
      : 'keywords only'
    step(`search index: ${index.stats.docs} sections (${kind}) ${pc.dim(seconds(performance.now() - phase))}`)

    if (features.search.enabled && features.search.modelSource === 'site' && index.file.semantic) {
      // The files the reader's browser would otherwise fetch from Hugging Face and from jsDelivr.
      const model = await modelFiles(index.file.semantic.model, config.root)
      const runtime = await runtimeFiles(config.root)
      if (model.length === 0 || runtime.length === 0) {
        const missing = model.length === 0 ? `the files of "${index.file.semantic.model}"` : 'the ONNX runtime'
        console.log(
          pc.yellow(
            `    features.search.modelSource is "site", but ${missing} could not be found beside Transformers.js. ` +
              'Readers get keyword search only.',
          ),
        )
      } else {
        const copies = [
          ...model.map((file) => ({ ...file, to: SEARCH_FILES.models + file.name })),
          ...runtime.map((file) => ({ ...file, to: SEARCH_FILES.runtime + file.name })),
        ]
        for (const { file, to } of copies) {
          await mkdir(path.dirname(path.join(outDir, to)), { recursive: true })
          await copyFile(file, path.join(outDir, to))
        }
        const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`
        const total = copies.reduce((sum, file) => sum + file.bytes, 0)
        const largest = copies.reduce((a, b) => (b.bytes > a.bytes ? b : a))
        step(`model and its runtime, served from the site: ${copies.length} files, ${megabytes(total)}`)
        console.log(pc.dim(`    The largest is ${largest.to}, ${megabytes(largest.bytes)}. Some hosts limit the size of one file.`))
      }
    }

    if (features.search.enabled && features.search.store === 'sqlite') {
      const database = await search.database()
      if (database) {
        await write(SEARCH_FILES.database, database.bytes)
        await write(SEARCH_FILES.manifest, JSON.stringify(database.manifest))
        step(`search database: ${(database.bytes.length / 1024).toFixed(0)} KB of SQLite`)
      } else {
        console.log(
          pc.yellow(
            '    features.search.store is "sqlite", but @sqlite.org/sqlite-wasm is not installed. Readers get the in-memory store.',
          ),
        )
      }
    }
  }

  if (features.feed.enabled) {
    const entries = feedEntries(context).length
    await write(FEED_FILE, renderFeed(context))
    step(`${FEED_FILE}: ${entries} ${entries === 1 ? 'page' : 'pages'}`)
    if (entries === 0) {
      console.log(
        pc.yellow('    The feed is empty: no page has a `date`, and none has a day it was last changed (`defaults.lastUpdated`).'),
      )
    }
  }

  /* ── for search engines ── */

  // The sitemap lists what a search engine should list. A site that asks not to be listed has none.
  const listed = site.noindex ? [] : pages.filter((page) => !page.frontmatter.noindex)
  const hasSitemap = site.url !== undefined && listed.length > 0
  if (hasSitemap) {
    const entries = listed.map((page) => ({ loc: pageAddress(context, page.path), lastmod: page.updated?.day }))
    await write('sitemap.xml', renderSitemap(entries))
  }

  // A robots.txt in public/ is the site's own, and was copied into dist/ with the other files there.
  const ownRobots = existsSync(path.join(config.root, 'public', 'robots.txt'))
  if (wantsRobots(site) && !ownRobots) {
    await write('robots.txt', renderRobots(site, hasSitemap ? publicUrl(context, '/sitemap.xml') : undefined))
    if (site.base !== '/') {
      console.log(
        pc.yellow(
          `    robots.txt was written, but crawlers only read it at the root of a host, and this site is served from ${site.base}`,
        ),
      )
    }
  }

  /* ── for reading without a connection ── */

  // After everything a reader may need is written, and before a host is given the folder.
  if (features.offline.enabled) {
    await write(
      OFFLINE_PAGE,
      renderDocument({
        config: config.config,
        title: 'No connection',
        description: '',
        path: '/',
        noindex: true,
        body: offlineBody(escapeHtml(site.base)),
        // The site's stylesheets and no script: there is nothing here to run.
        head: assets.styleTags(),
        ...(paletteFile ? { paletteStylesheet: withBase(site.base, `/${paletteFile}`) } : {}),
      }),
    )
    const offline = await offlineFiles(outDir, assets.ahead())
    await write(SERVICE_WORKER_FILE, serviceWorker(site.base, offline))
    step(`offline: ${offline.files.length} files, ${(offline.bytes / 1024 / 1024).toFixed(1)} MB, fetched by a reader's browser after a first visit`)
  }

  /* ── for the host ── */

  // Last: by now dist/ holds everything an adapter may copy or point at.
  if (adapter) {
    phase = performance.now()
    const written = await adapter.write({ config, outDir, moved })
    step(
      written.files.length
        ? `${adapter.name}: ${written.files.join(', ')} ${pc.dim(seconds(performance.now() - phase))}`
        : `${adapter.name}: nothing to write. The site has no MCP endpoint and no redirects`,
    )
    for (const note of written.notes) console.log(pc.yellow(`    ${note}`))
  }

  await compiler.cache.prune()
  await compiler.cache.flush()

  if (problems.length) console.log(`\n${problems.map(formatProblem).join('\n')}`)
  console.log(
    `\n  ${pc.bold('Done')} in ${seconds(performance.now() - started)}. ` +
      `Output: ${pc.cyan(path.relative(process.cwd(), outDir) || 'dist')}\n`,
  )
}

/** Turns Vite's manifest into the <link> and <script> tags a page needs. */
class AssetResolver {
  #manifest: Manifest
  #entry: ManifestChunk
  /** The app's own chunks, which every page needs. They are found once, not once for each page. */
  #shared: { chunks: ManifestChunk[]; keys: Set<string> }
  #base: string
  #root: string

  constructor(manifest: Manifest, context: ShabdContext) {
    this.#manifest = manifest
    this.#base = context.config.config.site.base
    this.#root = context.config.root
    const entryKey = Object.keys(manifest).find((key) => manifest[key]!.isEntry)
    if (entryKey === undefined) throw new Error('shabd: the build manifest has no entry chunk')
    this.#entry = manifest[entryKey]!
    const keys = new Set<string>()
    this.#shared = { chunks: this.#closure(entryKey, keys), keys }
  }

  #url(file: string): string {
    return escapeHtml(withBase(this.#base, `/${file}`))
  }

  /** A chunk and everything it statically imports, depth first. */
  #closure(key: string, seen = new Set<string>()): ManifestChunk[] {
    if (seen.has(key)) return []
    seen.add(key)
    const chunk = this.#manifest[key]
    if (!chunk) return []
    return [chunk, ...(chunk.imports ?? []).flatMap((imported) => this.#closure(imported, seen))]
  }

  /** Stylesheets, plus preloads for the app and for this page's own chunk, so the first render needs no waterfall. */
  headTags(pageFile?: string): string {
    const chunks = [...this.#shared.chunks]
    if (pageFile) {
      const key = path.relative(this.#root, pageFile).split(path.sep).join('/')
      chunks.push(...this.#closure(key, new Set(this.#shared.keys)))
    }
    const styles = [...new Set(chunks.flatMap((chunk) => chunk.css ?? []))]
    const scripts = [...new Set(chunks.map((chunk) => chunk.file))].filter((file) => file !== this.#entry.file)
    return [
      ...styles.map((file) => `<link rel="stylesheet" href="${this.#url(file)}">`),
      ...scripts.map((file) => `<link rel="modulepreload" href="${this.#url(file)}">`),
    ].join('\n    ')
  }

  /**
   * The bundled files a page needs when it is shown, or one step later: what
   * the app loads, every page's own chunk, and what either of them asks for
   * on demand (the search dialog, the form that tries a request). What those
   * in turn load on demand is not among them: the library that draws
   * diagrams, the compiler of a live sandbox. Those are megabytes, for the
   * pages that use them.
   */
  ahead(): Set<string> {
    const entryKey = Object.keys(this.#manifest).find((key) => this.#manifest[key] === this.#entry)!
    const chunks = this.#closure(entryKey, new Set())
    const seen = new Set<string>()
    const all = [...chunks]
    // The pages are among these: the route table, which the app loads, imports each of them on demand.
    for (const chunk of chunks) for (const key of chunk.dynamicImports ?? []) all.push(...this.#closure(key, seen))
    return new Set(all.flatMap((chunk) => [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]))
  }

  /** The app's stylesheets alone, for a document that runs no script. */
  styleTags(): string {
    return [...new Set(this.#shared.chunks.flatMap((chunk) => chunk.css ?? []))]
      .map((file) => `<link rel="stylesheet" href="${this.#url(file)}">`)
      .join('\n    ')
  }

  entryScript(): string {
    return `<script type="module" src="${this.#url(this.#entry.file)}"></script>`
  }
}
