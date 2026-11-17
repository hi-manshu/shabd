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
import { normalizePath as normalizeRoute, stripBase } from '../../shared/paths.js'
import { codeBackgrounds } from '../../shared/presets.js'
import { renderDocument } from '../build/html.js'
import { isShabdError } from '../config/errors.js'
import { loadConfig, loadSidebar, type ResolvedConfig } from '../config/load.js'
import { compilePage, createContext, type ShabdContext } from '../context.js'
import { MDX_COMPONENTS_ID } from '../markdown/compile.js'
import { HMR_RUNTIME_ID, PAGE_ERROR_ID, toErrorModule, toPageModule } from '../markdown/page-module.js'
import { CLIENT_DIR, CLIENT_ENTRY, PACKAGE_ROOT, packageName, resolveFromPackage, SERVER_ENTRY } from '../paths.js'
import { keepBase } from './dev-html.js'
import { devMiddlewares } from './dev-middleware.js'

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
  embedder: 'virtual:shabd/embedder',
  sqlite: 'virtual:shabd/sqlite',
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
        build,
      }
    },

    resolveId(id) {
      if (VIRTUAL_IDS.has(id)) return resolved(id)
      if (id === HMR_RUNTIME_ID) return path.join(CLIENT_DIR, 'app', 'hmr.ts')
      if (id === PAGE_ERROR_ID) return path.join(CLIENT_DIR, 'app', 'PageError.tsx')
      return undefined
    },

    load(id) {
      if (!id.startsWith('\0virtual:shabd/')) return undefined
      const { config, store, dev } = ctx()

      switch (id.slice(1)) {
        case VIRTUAL.data:
          return `export default ${JSON.stringify(store.siteData({ dev }))}\n${revisionOf(dev)}`

        case VIRTUAL.routes: {
          const routes = store.pages().map((page) => `  ${JSON.stringify(page.path)}: () => import(${importPath(page.file)}),`)
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

        case VIRTUAL.fonts:
          return `${bundledFonts(config)
            .map((file) => `import ${importPath(file)}`)
            .join('\n')}\n`

        case VIRTUAL.styles:
          return `${config.stylesheets.map((file) => `import ${importPath(file)}`).join('\n')}\n`

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
          source: code,
          format: file.toLowerCase().endsWith('.mdx') ? 'mdx' : 'md',
          id: page?.id,
          routePath: page?.path,
          hash: page?.hash,
          liftTitle: page?.titleFromHeading,
        })
      } catch (error) {
        // In dev a page that does not compile is served as a module that shows
        // the error in place. Builds, and files that are not pages, fail as usual.
        if (!context.dev || !page || !isShabdError(error)) throw error
        hotFiles.delete(file)
        this.environment.logger.error(error.pretty(context.config.root), { timestamp: true })
        return {
          code: toErrorModule(error, path.relative(context.config.root, file), page.frontmatter, page.id),
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
          ? toPageModule(compiled, page.frontmatter, context.dev ? page.id : undefined)
          : compiled.code,
        map: { mappings: '' },
      }
    },

    async hotUpdate({ type, file, read, server }) {
      if (this.environment.name !== 'client') return undefined
      const context = ctx()
      const { config, store } = context
      const client = server.environments.client
      const reload = (id: string) => {
        const module = client.moduleGraph.getModuleById(resolved(id))
        if (module) resend(client, module)
      }
      const same = (a: string, b: string) => normalizePath(a) === normalizePath(b)

      if (same(file, config.configFile)) {
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
        try {
          store.setSidebar(await loadSidebar(config))
          logSidebarWarnings(server, context)
          reload(VIRTUAL.data)
        } catch (error) {
          reportError(server, error)
        }
        return []
      }

      if (!store.owns(file)) return undefined

      if (type === 'delete') {
        if (store.remove(file)) {
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
      const { page, change } = await store.upsert(file, source)
      // Same bytes as before (a save without edits, or the second of two
      // watchers reporting one save): nothing to update.
      if (change === 'none') return []
      if (change === 'added') {
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

    closeBundle() {
      contentWatcher?.close()
      contentWatcher = undefined
    },

    configureServer(server) {
      const context = ctx()
      server.watcher.add([context.config.configFile, context.config.sidebarFile])
      logSidebarWarnings(server, context)
      for (const error of context.store.errors()) server.config.logger.error(error.pretty(context.config.root))

      contentWatcher?.close()
      contentWatcher = watchContent(server, ctx)

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
            const entry = `${site.base}@fs/${normalizePath(CLIENT_ENTRY).replace(/^\//, '')}`
            const html = await server.transformIndexHtml(
              url,
              renderDocument({
                config: config.config,
                title: page?.title ?? 'Page not found',
                description: page?.description ?? '',
                path: route,
                scripts: `<script type="module" src="${entry}"></script>`,
              }),
            )
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

  return [core, react(), ...keepBase(() => ctx().config.config.site.base)]
}

/* ───────────────────────────── helpers ───────────────────────────── */

/**
 * Is this request for a page, as opposed to a script, an image or a fetch
 * that happens to have missed? Browsers say what a request is for; for
 * everything else (curl, health checks) a path without a file extension is
 * taken to be a page.
 */
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
    JSON.stringify([next.components, next.blocks, next.stylesheets, bundledFonts(next), next.config.features.search]) !==
      JSON.stringify([
        previous.components,
        previous.blocks,
        previous.stylesheets,
        bundledFonts(previous),
        previous.config.features.search,
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
