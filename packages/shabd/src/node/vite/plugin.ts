/**
 * The Vite plugin: how YAML and Markdown become modules.
 *
 * Virtual modules (data the browser imports):
 *   virtual:shabd/data            site config, layouts, sidebar, page index (JSON)
 *   virtual:shabd/routes          route path → () => import(page)
 *   virtual:shabd/mdx-components  built-in + user components for MDX
 *   virtual:shabd/blocks          user layout blocks
 *   virtual:shabd/fonts           bundled font faces, if the theme uses them
 *   virtual:shabd/user-styles     the site's own stylesheets (`theme.css`)
 *   virtual:shabd/embedder        Transformers.js, if semantic search is on
 *   virtual:shabd/sqlite          SQLite WASM, if the search store is `sqlite`
 *
 * Transform:
 *   *.md / *.mdx                  → React component + frontmatter + toc
 *
 * Hot updates are routed by what changed, so an edit touches as little as
 * possible:
 *   page body         → that page's module re-evaluates and swaps in place
 *   page frontmatter  → the above, plus `data` if navigation is affected
 *   page added/removed→ `routes` and `data`
 *   sidebar.yaml      → `data`
 *   shabd.config.yaml → `data` (tokens, layouts, site info); restart only
 *                       when the change alters compiled output
 */
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import pc from 'picocolors'
import {
  normalizePath,
  searchForWorkspaceRoot,
  type BuildOptions,
  type DevEnvironment,
  type EnvironmentModuleNode,
  type Plugin,
  type PluginOption,
  type ViteDevServer,
} from 'vite'
import { normalizePath as normalizeRoute, siteHref, stripBase } from '../../shared/paths.js'
import { codeBackgrounds } from '../../shared/presets.js'
import { documentEdition, textAt } from '../build/editions.js'
import { renderDocument } from '../build/html.js'
import { isShabdError } from '../config/errors.js'
import { loadConfig, loadSidebar, type ResolvedConfig } from '../config/load.js'
import { pageMeta } from '../content/store.js'
import { substituteVars } from '../content/vars.js'
import { compilePage, createContext, isSplit, type ShabdContext } from '../context.js'
import { MDX_COMPONENTS_ID } from '../markdown/compile.js'
import { HMR_RUNTIME_ID, PAGE_ERROR_ID, toErrorModule, toPageModule } from '../markdown/page-module.js'
import { themedCodeCss } from '../markdown/plugins/rehype-code.js'
import { hasMermaid, mathStylesheet } from '../markdown/user-plugins.js'
import { CLIENT_DIR, CLIENT_ENTRY, PACKAGE_ROOT, packageName, resolveFromPackage, SERVER_ENTRY } from '../paths.js'
import { buildFrameRuntime, type FrameRuntime } from '../sandbox/frame.js'
import { devMiddlewares } from './dev-middleware.js'
import { SecondLook } from './second-look.js'

export interface ShabdPluginOptions {
  /** Folder containing shabd.config.yaml. Defaults to Vite's root. */
  root?: string
  /** A context created by the caller (the CLI does this for builds so all steps share one cache). */
  context?: ShabdContext
}

const VIRTUAL = {
  data: 'virtual:shabd/data',
  routes: 'virtual:shabd/routes',
  components: MDX_COMPONENTS_ID,
  blocks: 'virtual:shabd/blocks',
  fonts: 'virtual:shabd/fonts',
  styles: 'virtual:shabd/user-styles',
  math: 'virtual:shabd/math-styles',
  mermaid: 'virtual:shabd/mermaid',
  embedder: 'virtual:shabd/embedder',
  sqlite: 'virtual:shabd/sqlite',
  sandboxModules: 'virtual:shabd/sandbox-modules',
  sandboxFrame: 'virtual:shabd/sandbox-frame',
} as const

const VIRTUAL_IDS = new Set<string>(Object.values(VIRTUAL))
const resolved = (id: string) => `\0${id}`

const PAGE_FILE = /\.mdx?$/i
/** Requests such as `page.md?raw` are for the file's text, not the compiled page. */
const RAW_QUERY = /[?&](?:raw|url|inline)\b/

const importPath = (file: string) => JSON.stringify(normalizePath(file))

export function shabd(options: ShabdPluginOptions = {}): PluginOption[] {
  let context: ShabdContext | undefined = options.context
  /** Pages with a hot update in flight: when the change was seen and how long compiling took. */
  const hotFiles = new Map<string, { at: number; compileMs?: number }>()
  let contentWatcher: FSWatcher | undefined
  /** Reads a changed file once more, in case a second save followed the first too closely to be reported. */
  let secondLook: SecondLook | undefined
  /** The script for the frames of isolated snippets, once a page of the dev server has asked for it. */
  let frame: Promise<FrameRuntime> | undefined
  /** The file a build writes the table of routes into, once the build has named its files. */
  let routesChunk: string | undefined
  /**
   * The page list and the site data are sent to the browser again whenever
   * they change, and two answers can arrive there in either order. Each says
   * when it was made, so that an older one never replaces a newer one
   * (client/app/store.ts). A build has one answer, and it says 0.
   */
  let lastRevision = 0
  const revisionOf = (dev: boolean) => {
    if (dev) lastRevision = Math.max(Date.now(), lastRevision + 1)
    return `export const revision = ${dev ? lastRevision : 0}\n`
  }

  const ctx = (): ShabdContext => {
    if (!context) throw new Error('shabd: plugin used before its config hook ran')
    return context
  }

  /**
   * `virtual:shabd/sandbox-frame`: the script for the frames of isolated snippets, as text. Making it
   * is a build of its own, so it is made when it is wanted: by the dev server when a page first shows
   * such a snippet, and by a build only for a site that has one.
   */
  const frameModule = async (ssr: boolean): Promise<string> => {
    const context = ctx()
    const nothing = `export default ''\n`
    // A page rendered ahead of time starts no frame.
    if (ssr || !context.config.config.features.sandbox.enabled) return nothing
    if (context.dev) {
      frame ??= buildFrameRuntime(context.config, true)
      try {
        return `export default ${JSON.stringify((await frame).code)}\n`
      } catch (error) {
        // Asked again, it is tried again: what was wrong may have been put right.
        frame = undefined
        throw error
      }
    }
    // The pages are compiled by now, so this reads what is kept of each. One that does not compile has stopped the build already.
    const pages = await Promise.all(context.store.pages().map((page) => compilePage(context, page).catch(() => undefined)))
    if (!pages.some((page) => page?.snippets.some((snippet) => snippet.isolated))) return nothing
    return `export default ${JSON.stringify((await buildFrameRuntime(context.config, false)).code)}\n`
  }

  const core: Plugin = {
    name: 'shabd',
    enforce: 'pre',

    async config(userConfig, env) {
      const dev = env.command === 'serve' && !env.isPreview
      // The dev server re-runs this hook on restart; rebuild the context so a
      // changed config takes full effect. A caller-supplied context is kept.
      if (!options.context) {
        context = await createContext(options.root ?? userConfig.root ?? process.cwd(), { dev })
      }
      // Made for the config there was: the modules snippets may import are in it.
      frame = undefined
      const { config } = ctx()
      if (dev) ctx().compiler.highlighter.warm()

      // `shabd build` runs Vite twice: once for the browser, once (isSsrBuild)
      // for the module that prerenders each page to HTML.
      const build: BuildOptions = env.isSsrBuild
        ? {
            ssr: true,
            outDir: serverOutDir(config),
            emptyOutDir: true,
            copyPublicDir: false,
            rolldownOptions: {
              input: { 'entry-server': SERVER_ENTRY },
              // `.mjs` is an ES module to Node whether or not the site's package.json says "type": "module".
              output: { entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' },
            },
          }
        : {
            outDir: path.join(config.root, 'dist'),
            emptyOutDir: true,
            manifest: true,
            rolldownOptions: { input: { app: CLIENT_ENTRY } },
            // Vite has every import that is made on demand also fetch, at the same moment, the files the
            // imported one will ask for. For the table of routes that list was the page's own file and
            // the few files every page imports, which a reader who can click a link already has: said
            // again for each route, with the name of every page's file in a second table. At 5,000 pages
            // that was a third of the first script. A page's stylesheets are still fetched with it.
            modulePreload: {
              resolveDependencies: (_file, deps, { hostId }) => (hostId === routesChunk ? deps.filter((dep) => dep.endsWith('.css')) : deps),
            },
            // Mermaid comes in pieces, one per kind of diagram, and a reader's browser fetches the pieces a
            // diagram needs. Two of them are large, and Vite would warn about each on every build of a
            // site that draws diagrams, with advice that does not apply: they are already loaded on demand.
            ...(config.config.markdown.mermaid ? { chunkSizeWarningLimit: 2000 } : {}),
          }

      return {
        root: config.root,
        base: config.config.site.base,
        appType: 'custom',
        publicDir: path.join(config.root, 'public'),
        cacheDir: path.join(config.cacheDir, 'vite'),
        resolve: { dedupe: ['react', 'react-dom'] },
        optimizeDeps: {
          // There is no index.html to crawl, so name the entry and the
          // dependencies every page needs up front.
          entries: [normalizePath(CLIENT_ENTRY)],
          include: [
            'react',
            'react-dom',
            'react-dom/client',
            'react/jsx-runtime',
            'react/jsx-dev-runtime',
            // Loaded lazily, so Vite would only discover them mid-session and reload the page.
            ...(config.config.features.sandbox.enabled ? [`${packageName()} > sucrase`] : []),
            // The packages snippets may import are only named in a generated module, where Vite would find
            // them when the first snippet runs, and reload the page to take them in.
            ...(config.config.features.sandbox.enabled ? config.sandboxModules.filter((module) => !path.isAbsolute(module.from)).map((module) => module.from) : []),
            ...(config.config.markdown.mermaid && hasMermaid(config.root) ? ['mermaid'] : []),
            ...(config.config.features.search.semantic && hasPackage(config.root, TRANSFORMERS) ? [TRANSFORMERS] : []),
          ],
          // SQLite finds its .wasm file next to its own module, which pre-bundling would move.
          // This package ships its browser code as source, which the site's own build compiles.
          exclude: [packageName(), SQLITE],
        },
        ssr: { noExternal: [packageName(), /^@fontsource/] },
        // The search worker loads its model lazily, which needs an ES-module
        // worker; and worker bundles get their own plugin list.
        worker: { format: 'es', plugins: () => [workerModules(ctx)] },
        server: { fs: { allow: [searchForWorkspaceRoot(config.root), PACKAGE_ROOT] } },
        // Vite compresses every file it wrote to report its size, and `shabd build` does not print that
        // report. On a site of thousands of pages the compressing took seconds.
        build: { reportCompressedSize: false, ...build },
      }
    },

    resolveId(id) {
      if (VIRTUAL_IDS.has(id)) return resolved(id)
      if (id === HMR_RUNTIME_ID) return path.join(CLIENT_DIR, 'app', 'hmr.ts')
      if (id === PAGE_ERROR_ID) return path.join(CLIENT_DIR, 'app', 'PageError.tsx')
      return undefined
    },

    load(id, options) {
      if (!id.startsWith('\0virtual:shabd/')) return undefined
      const { config, store, dev } = ctx()

      switch (id.slice(1)) {
        case VIRTUAL.data:
          return `export default ${JSON.stringify(store.siteData({ dev }))}\n${revisionOf(dev)}`

        case VIRTUAL.routes: {
          // A file that has just been deleted is still a page here for a tenth of a second, until the watcher
          // says it is gone. If another page is added in that time (a rename is both at once), this list is
          // made again with the deleted file in it. Vite cannot resolve an import of a file that is not
          // there, fails the whole module, and the browser gives up on the update and loads the page again.
          const pages = dev ? store.pages().filter((page) => existsSync(page.file)) : store.pages()
          const routes = pages.map((page) => `  ${JSON.stringify(page.path)}: () => import(${importPath(page.file)}),`)
          return `export const routes = {\n${routes.join('\n')}\n}\n${revisionOf(dev)}`
        }

        case VIRTUAL.components: {
          const user = Object.entries(config.components)
          return [
            `import { components } from ${importPath(path.join(CLIENT_DIR, 'mdx', 'index.tsx'))}`,
            ...user.map(([, file], i) => `import C${i} from ${importPath(file)}`),
            `const all = { ...components, ${user.map(([name], i) => `${JSON.stringify(name)}: C${i}`).join(', ')} }`,
            `export function useMDXComponents() { return all }`,
            '',
          ].join('\n')
        }

        case VIRTUAL.blocks: {
          const user = Object.entries(config.blocks)
          return [
            ...user.map(([, file], i) => `import B${i} from ${importPath(file)}`),
            `export const customBlocks = { ${user.map(([name], i) => `${JSON.stringify(name)}: B${i}`).join(', ')} }`,
            '',
          ].join('\n')
        }

        case VIRTUAL.sandboxModules: {
          // What a live snippet may import (`features.sandbox.modules`). Each is behind an import of its
          // own, so that a page fetches a module only when one of its snippets asks for it.
          const modules = config.sandboxModules.map(
            ({ name, from }) => `  ${JSON.stringify(name)}: () => import(${path.isAbsolute(from) ? importPath(from) : JSON.stringify(from)}),`,
          )
          return `export const modules = {\n${modules.join('\n')}\n}\n`
        }

        case VIRTUAL.sandboxFrame:
          return frameModule(options?.ssr === true)

        case VIRTUAL.fonts:
          return `${bundledFonts(config)
            .map((file) => `import ${importPath(file)}`)
            .join('\n')}\n`

        case VIRTUAL.styles:
          return `${config.stylesheets.map((file) => `import ${importPath(file)}`).join('\n')}\n`

        case VIRTUAL.math: {
          // KaTeX's stylesheet and the fonts it names, on sites that typeset maths and on no others.
          const stylesheet = config.config.markdown.math ? mathStylesheet(config.root) : undefined
          return stylesheet ? `import ${importPath(stylesheet)}\n` : ''
        }

        case VIRTUAL.mermaid:
          // Mermaid for a site that draws diagrams and has it installed; nothing for any other.
          return config.config.markdown.mermaid && hasMermaid(config.root)
            ? `export { default } from 'mermaid'\n`
            : `export default undefined\n`

        case VIRTUAL.embedder:
          return embedderModule(config)

        case VIRTUAL.sqlite:
          return sqliteModule(config)

        default:
          return undefined
      }
    },

    async transform(code, id) {
      const [file = id] = id.split('?')
      if (!PAGE_FILE.test(file) || RAW_QUERY.test(id)) return undefined
      const context = ctx()
      const started = performance.now()

      // The store may not have seen this version of the file yet (a save can
      // race the watcher), so bring it up to date with the code we were given.
      const page = context.store.owns(file) ? (await context.store.upsert(file, code)).page : undefined

      let compiled
      try {
        if (page?.error) throw page.error
        compiled = await context.compiler.compile({
          file,
          // A page as the store read it, with the site's variables filled in. A partial that a page
          // imports is not in the store, and has them filled in here.
          source: page ? page.source : substituteVars(code, context.config.vars).text,
          format: file.toLowerCase().endsWith('.mdx') ? 'mdx' : 'md',
          id: page?.id,
          routePath: page?.path,
          hash: page?.hash,
          liftTitle: page?.titleFromHeading,
          split: page ? isSplit(context, page) : false,
        })
      } catch (error) {
        // In dev a page that does not compile is served as a module that shows
        // the error in place. Builds, and files that are not pages, fail as usual.
        if (!context.dev || !page || !isShabdError(error)) throw error
        hotFiles.delete(file)
        this.environment.logger.error(error.pretty(context.config.root), { timestamp: true })
        return {
          code: toErrorModule(error, path.relative(context.config.root, file), pageMeta(page), page.frontmatter, page.id),
          map: { mappings: '' },
        }
      }

      const hot = hotFiles.get(file)
      if (hot) {
        hotFiles.delete(file)
        const compile = (hot.compileMs ?? performance.now() - started).toFixed(1)
        const total = (performance.now() - hot.at).toFixed(1)
        this.environment.logger.info(
          `${pc.magenta('shabd')} ${pc.dim('hot')} ${page?.id ?? path.basename(file)} ` +
            pc.dim(`compiled in ${compile}ms, served ${total}ms after the change was seen`),
          { timestamp: true },
        )
      }

      return {
        code: page
          ? toPageModule(
              compiled,
              pageMeta(page),
              page.frontmatter,
              context.dev ? page.id : undefined,
              page.updated,
              // In a build these are in one stylesheet for the whole site (src/node/build/build.ts).
              context.dev ? themedCodeCss(context.compiler.highlighter.keys, compiled.codeColours) : '',
            )
          : compiled.code,
        map: { mappings: '' },
      }
    },

    async hotUpdate({ type, file, modules, read, server, timestamp }) {
      if (this.environment.name !== 'client') return undefined
      const context = ctx()
      const { config, store } = context
      const client = server.environments.client

      // A file that went into the script for isolated snippets. The script is made again when it is next
      // asked for, and the frames on screen run the old one: the page starts again to ask.
      if (frame) {
        const built = await frame.catch(() => undefined)
        if (built?.files.some((used) => normalizePath(used) === normalizePath(file))) {
          frame = undefined
          const module = client.moduleGraph.getModuleById(resolved(VIRTUAL.sandboxFrame))
          if (module) {
            client.moduleGraph.invalidateModule(module)
            client.hot.send({ type: 'full-reload' })
          }
        }
      }
      const reload = (id: string) => {
        const module = client.moduleGraph.getModuleById(resolved(id))
        if (module) resend(client, module)
      }
      const same = (a: string, b: string) => normalizePath(a) === normalizePath(b)
      /** What the file holds as this change is handled, for the look that follows. */
      const lookAgain = async () => {
        try {
          secondLook?.after(file, await read())
        } catch {
          // The file is gone: there is nothing to look at again.
        }
      }

      if (same(file, config.configFile)) {
        await lookAgain()
        await reloadConfig(server, context, {
          data: () => reload(VIRTUAL.data),
          // Every page the browser has loaded is compiled again and swapped in, as after an edit to it.
          pages: () => {
            for (const page of store.pages()) {
              for (const module of client.moduleGraph.getModulesByFile(normalizePath(page.file)) ?? []) resend(client, module)
            }
          },
        })
        return []
      }

      if (same(file, config.sidebarFile)) {
        await lookAgain()
        try {
          store.setSidebar(await loadSidebar(config))
          logSidebarWarnings(server, context)
          reload(VIRTUAL.data)
        } catch (error) {
          reportError(server, error)
        }
        return []
      }

      // An OpenAPI description. Its pages are made again; the ones the browser has are swapped in place.
      if (config.openapi.some((api) => same(file, api.spec))) {
        await lookAgain()
        try {
          const { added, changed, removed } = await store.regenerate()
          if (added.length > 0 || removed.length > 0) reload(VIRTUAL.routes)
          // The sidebar has the API's groups and titles in it, whether or not the set of pages changed.
          reload(VIRTUAL.data)
          for (const page of changed) {
            for (const module of client.moduleGraph.getModulesByFile(normalizePath(page.file)) ?? []) void client.reloadModule(module)
          }
          const count = added.length + changed.length + removed.length
          server.config.logger.info(
            `${pc.magenta('shabd')} ${path.relative(config.root, file)} changed: ${count} ${count === 1 ? 'page' : 'pages'} made again`,
            { timestamp: true },
          )
        } catch (error) {
          // A description that cannot be read leaves the pages as they were, and says what is wrong with it.
          reportError(server, error)
        }
        return []
      }

      if (!store.owns(file)) {
        // A file beside the pages: an image, most often. Vite remembers every file it has served. When one
        // that no page uses any more is made again, or written to, it finds nothing that can take the change
        // and loads the whole page again. That happened to a picture pasted under a name that had been used
        // before, and took the Studio and the link it had not saved yet with it. What nothing uses is left out.
        const fromContent = path.relative(config.contentDir, file)
        const beside = !fromContent.startsWith('..') && !path.isAbsolute(fromContent)
        return beside ? modules.filter((module) => module.file !== normalizePath(file) || module.importers.size > 0) : undefined
      }

      // What Vite has compiled of a page, and what the browser has fetched, is from the file as it was. Vite
      // keeps both for a file that is gone, and gives them out again when a file of that name comes back: a
      // page deleted and made again, or renamed and renamed back, was shown as it had been before. Marked out
      // of date here, the page is compiled again, and the routes fetch it under an address the browser has
      // not seen.
      const forget = () => {
        for (const module of modules) client.moduleGraph.invalidateModule(module, new Set(), timestamp, true)
      }

      if (type === 'delete') {
        if (store.remove(file)) {
          forget()
          reload(VIRTUAL.routes)
          reload(VIRTUAL.data)
        }
        return []
      }

      let source: string
      try {
        source = await read()
      } catch (error) {
        // The file went away between the event and the read (deleted, or
        // renamed by an editor's atomic save). Its delete event deals with it.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
      secondLook?.after(file, source)
      const { page, change } = await store.upsert(file, source)
      // The file can have gone while it was being read: a page that is saved and then renamed or deleted at
      // once. Its removal has been handled by now, and what was read would bring the page back with no file
      // behind it, to stay in the sidebar until the server starts again.
      if (!existsSync(file)) {
        if (store.remove(file)) {
          forget()
          reload(VIRTUAL.routes)
          reload(VIRTUAL.data)
        }
        return []
      }
      // Same bytes as before (a save without edits, or the second of two
      // watchers reporting one save): nothing to update.
      if (change === 'none') return []
      if (change === 'added') {
        forget()
        reload(VIRTUAL.routes)
        reload(VIRTUAL.data)
        return []
      }
      if (change === 'meta') reload(VIRTUAL.data)
      const hot: { at: number; compileMs?: number } = { at: performance.now() }
      hotFiles.set(normalizePath(file), hot)
      // Start compiling now. The browser's request for the new module, which
      // arrives a few milliseconds later, joins this compilation.
      if (!page.error) {
        void compilePage(context, page).then(
          (result) => {
            hot.compileMs = result.ms
          },
          () => {},
        )
      }
      // Fall through to Vite's default: the page module accepts its own update.
      return undefined
    },

    generateBundle(_options, bundle) {
      // Before Vite works out what each import made on demand should fetch with it (`modulePreload`, above).
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.moduleIds.includes(resolved(VIRTUAL.routes))) routesChunk = chunk.fileName
      }
    },

    closeBundle() {
      contentWatcher?.close()
      contentWatcher = undefined
      secondLook?.close()
      secondLook = undefined
    },

    configureServer(server) {
      const context = ctx()
      server.watcher.add([context.config.configFile, context.config.sidebarFile, ...context.config.openapi.map((api) => api.spec)])
      logSidebarWarnings(server, context)
      for (const error of context.store.errors()) server.config.logger.error(error.pretty(context.config.root))
      if (context.store.lastUpdatedNote) {
        server.config.logger.warn(`${pc.yellow('shabd')} defaults.lastUpdated is on, but ${context.store.lastUpdatedNote}.`)
      }

      contentWatcher?.close()
      contentWatcher = watchContent(server, ctx)
      secondLook?.close()
      secondLook = new SecondLook({ report: (file) => server.watcher.emit('change', normalizePath(file)) })

      // Installed after Vite's own middlewares, so requests have passed its
      // host check and CORS policy. First the dev endpoints (llms.txt, MCP,
      // search index, Studio); then anything that still looks like a page
      // navigation gets the app shell, and the client router takes over.
      return () => {
        server.middlewares.use(devMiddlewares(ctx, server))
        server.middlewares.use(async (req, res, next) => {
          const url = req.originalUrl ?? req.url ?? '/'
          if (req.method !== 'GET' || !isPageRequest(req.headers, url)) return next()
          try {
            const { config, store } = ctx()
            const { site } = config.config
            const route = normalizeRoute(stripBase(site.base, url.split(/[?#]/)[0] ?? '/'))
            const page = store.byPath(route)
            // An address that has moved. A build writes a page that sends the reader on; a server can just say so.
            const redirect = page ? undefined : config.redirects.find((entry) => entry.from === route)
            if (redirect) {
              res.statusCode = 302
              res.setHeader('Location', siteHref(redirect.to, site, (path) => store.byPath(path) !== undefined))
              res.end()
              return
            }
            const edition = documentEdition(ctx(), route)
            const html = renderDocument({
              config: config.config,
              title: page?.title ?? textAt(config, route)('notFound.title'),
              description: page?.description ?? '',
              path: route,
              noindex: !page || page.frontmatter.noindex || edition.noindex,
              lang: edition.lang,
              dir: edition.dir,
              alternates: edition.alternates,
              image: page?.frontmatter.image,
              ...(await devTags(server, url)),
            })
            res.statusCode = page ? 200 : 404
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(html)
          } catch (error) {
            next(error)
          }
        })
      }
    },
  }

  return [core, react()]
}

/* ───────────────────────────── helpers ───────────────────────────── */

/**
 * Is this request for a page, as opposed to a script, an image or a fetch
 * that happens to have missed? Browsers say what a request is for; for
 * everything else (curl, health checks) a path without a file extension is
 * taken to be a page.
 */
/**
 * What the dev server adds to a page: its own client and React's refresh
 * preamble for the head, and the app's entry for the end of the body.
 *
 * Vite is given a page that holds the entry and nothing else, and not Shabd's
 * document. It puts the site's base in front of every address in a page that
 * starts with a slash, and the addresses in Shabd's document have the base
 * already, as a build needs them: given the document, a site with a base got
 * `/base/base/…` for its entry, and a page with nothing on it.
 */
async function devTags(server: ViteDevServer, url: string): Promise<{ head: string; scripts: string }> {
  // Without the base: Vite adds it.
  const entry = `/@fs/${normalizePath(CLIENT_ENTRY).replace(/^\//, '')}`
  const shell = await server.transformIndexHtml(url, `<html><head></head><body><script type="module" src="${entry}"></script></body></html>`)
  const inside = (tag: string) => new RegExp(`<${tag}>([\\s\\S]*)</${tag}>`).exec(shell)?.[1]?.trim() ?? ''
  return { head: inside('head'), scripts: inside('body') }
}

function isPageRequest(headers: Record<string, string | string[] | undefined>, url: string): boolean {
  const destination = headers['sec-fetch-dest']
  if (typeof destination === 'string') return destination === 'document' || destination === 'iframe'
  if ((headers.accept ?? '').includes('text/html')) return true
  return path.extname(url.split(/[?#]/)[0] ?? '') === ''
}

const TRANSFORMERS = '@huggingface/transformers'
const SQLITE = '@sqlite.org/sqlite-wasm'

/** `virtual:shabd/embedder`: Transformers.js when semantic search can run, an inert stub when it cannot. */
function embedderModule(config: ResolvedConfig): string {
  const { search } = config.config.features
  const available = search.enabled && search.semantic && hasPackage(config.root, TRANSFORMERS)
  return available
    ? `export { pipeline, env } from '${TRANSFORMERS}'\nexport const available = true\n`
    : `export const pipeline = undefined\nexport const env = undefined\nexport const available = false\n`
}

/** `virtual:shabd/sqlite`: SQLite WASM when the site asked for the SQLite store and has it installed. */
function sqliteModule(config: ResolvedConfig): string {
  const { search } = config.config.features
  const available = search.enabled && search.store === 'sqlite' && hasPackage(config.root, SQLITE)
  return available
    ? `export { default as init } from '${SQLITE}'\nexport const available = true\n`
    : `export const init = undefined\nexport const available = false\n`
}

/** The virtual modules the search worker imports, for Vite's separate worker build. */
function workerModules(ctx: () => ShabdContext): Plugin {
  const modules: Record<string, (config: ResolvedConfig) => string> = {
    [resolved(VIRTUAL.embedder)]: embedderModule,
    [resolved(VIRTUAL.sqlite)]: sqliteModule,
  }
  return {
    name: 'shabd:worker-modules',
    resolveId: (id) => (resolved(id) in modules ? resolved(id) : undefined),
    load: (id) => modules[id]?.(ctx().config),
  }
}

/** Where the prerender bundle is written. It is an intermediate, not part of the site. */
export function serverOutDir(config: ResolvedConfig): string {
  return path.join(config.cacheDir, 'server')
}

/**
 * A second, faster watcher over the content directory.
 *
 * Vite's watcher is tuned to coalesce bursts of changes, which on macOS adds
 * roughly 100ms before an edit is noticed. Node's native recursive watch
 * reports the same save in about 13ms (measured on macOS 26, Node 22). For
 * pages already known to the store, this watcher hands the change to Vite's
 * normal HMR pipeline straight away; when Vite's own watcher reports the same
 * save later, the content hash is unchanged and the update is skipped.
 *
 * New and deleted files are left to Vite's watcher, where latency does not
 * matter and add/unlink semantics are already handled.
 */
function watchContent(server: ViteDevServer, ctx: () => ShabdContext): FSWatcher | undefined {
  const { contentDir } = ctx().config
  try {
    const watcher = watch(contentDir, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const file = path.join(contentDir, filename.toString())
      // The native watcher reports deletions and renames as plain events too.
      // Only a page that is still on disk has "changed".
      if (ctx().store.byFile(file) && existsSync(file)) server.watcher.emit('change', normalizePath(file))
    })
    watcher.on('error', () => watcher.close())
    return watcher
  } catch {
    // Recursive watching is unavailable on this platform: Vite's watcher still covers everything.
    return undefined
  }
}

/** The default theme's fonts ship with Shabd and are self-hosted. They are only bundled if the font stack names them. */
function bundledFonts(config: ResolvedConfig): string[] {
  const { sans, mono } = config.config.theme.typography
  const files: (string | undefined)[] = []
  if (/Anek Latin/i.test(sans)) files.push(resolveFromPackage('@fontsource-variable/anek-latin/wdth.css'))
  if (/Red Hat Mono/i.test(mono)) {
    files.push(
      resolveFromPackage('@fontsource-variable/red-hat-mono/wght.css'),
      resolveFromPackage('@fontsource-variable/red-hat-mono/wght-italic.css'),
    )
  }
  return files.filter((file): file is string => file !== undefined)
}

/** Is an optional package installed where the site, or Shabd itself, can load it? */
function hasPackage(root: string, name: string): boolean {
  try {
    createRequire(path.join(root, 'package.json')).resolve(name)
    return true
  } catch {
    return resolveFromPackage(name) !== undefined
  }
}

/**
 * Send the browser a module again, made from what it is made from now.
 *
 * `reloadModule` alone is not enough. A request for the module that was under
 * way when the update was sent has read the old state, and Vite keeps its
 * result and gives it to every later request: after a page was renamed, the
 * browser could be left with the list of pages from before the rename, until
 * something else changed. Vite does drop such a result for a module it was
 * told had changed, which is what it does itself for a file that was saved.
 */
function resend(environment: DevEnvironment, module: EnvironmentModuleNode): void {
  environment.moduleGraph.invalidateModule(module)
  void environment.reloadModule(module)
}

function reportError(server: ViteDevServer, error: unknown): void {
  if (!isShabdError(error)) {
    server.config.logger.error(String(error))
    return
  }
  server.config.logger.error(error.pretty(server.config.root), { timestamp: true })
  server.environments.client.hot.send({
    type: 'error',
    err: {
      message: error.issues.map((issue) => issue.message).join('\n'),
      stack: '',
      id: error.file,
      plugin: 'shabd',
      ...(error.frame ? { frame: error.frame } : {}),
      ...(error.loc ? { loc: error.loc } : {}),
    },
  })
}

function logSidebarWarnings(server: ViteDevServer, context: ShabdContext): void {
  const file = path.relative(context.config.root, context.config.sidebarFile)
  for (const warning of context.store.sidebarWarnings()) {
    const where = warning.line !== undefined ? `${file}:${warning.line}` : file
    server.config.logger.warn(`${pc.yellow('shabd')} ${pc.dim(where)} ${warning.message}`)
  }
}

/**
 * Apply an edited shabd.config.yaml to a running server.
 *
 * Most edits (tokens, site info, layouts' regions, feature options) only
 * change data the browser already knows how to re-read, so they hot-swap.
 * An edit to the colours behind code also changes what code compiles to,
 * because token colours are held to a contrast floor against them: the open
 * pages are compiled again and swapped in. Other edits that change what
 * pages compile to, or which files exist, restart.
 */
async function reloadConfig(
  server: ViteDevServer,
  context: ShabdContext,
  refresh: { data: () => void; pages: () => void },
): Promise<void> {
  let next: ResolvedConfig
  try {
    next = await loadConfig(context.config.root)
  } catch (error) {
    reportError(server, error)
    return
  }

  const previous = context.config
  const structural =
    next.structureFingerprint !== previous.structureFingerprint ||
    next.contentDir !== previous.contentDir ||
    next.sidebarFile !== previous.sidebarFile ||
    // The days pages were last changed are read from Git once, when the server starts.
    next.config.defaults.lastUpdated !== previous.config.defaults.lastUpdated ||
    // Which descriptions pages are made from, and where they go: the pages are made when the server starts.
    JSON.stringify([next.components, next.blocks, next.stylesheets, bundledFonts(next), next.config.features.search, next.openapi, next.sandboxModules]) !==
      JSON.stringify([
        previous.components,
        previous.blocks,
        previous.stylesheets,
        bundledFonts(previous),
        previous.config.features.search,
        previous.openapi,
        previous.sandboxModules,
      ])

  if (structural) {
    server.config.logger.info(`${pc.magenta('shabd')} config changed, restarting`, { timestamp: true })
    await server.restart()
    return
  }

  context.config = next
  context.store.setConfig(next)
  if (next.compileFingerprint !== previous.compileFingerprint) {
    context.compiler.recolour(codeBackgrounds(next.config.theme), next.compileFingerprint)
    refresh.pages()
  }
  refresh.data()
  server.config.logger.info(`${pc.magenta('shabd')} ${pc.dim('hot')} shabd.config.yaml`, { timestamp: true })
}
