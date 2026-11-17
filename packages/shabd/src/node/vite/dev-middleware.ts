/**
 * Dev-server endpoints.
 *
 * They mirror what a production build writes to disk (llms.txt, per-page
 * Markdown, the search index) or what a host serves (the MCP route), so a
 * site behaves the same in `shabd dev` as it does deployed. The Studio's
 * file endpoints exist only here.
 *
 * This middleware is installed *after* Vite's own, so every request has
 * already passed Vite's host check (which blocks DNS rebinding) and CORS
 * policy before it gets here.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import nodePath from 'node:path'
import { normalizePath, type Connect, type ViteDevServer } from 'vite'
import { fileToSlug, slugToPath, stripBase } from '../../shared/paths.js'
import { SEARCH_FILES } from '../../shared/search-core.js'
import type { ShabdContext } from '../context.js'
import { readBody, sendJson, sendText, sendWebResponse, toWebRequest } from '../http.js'
import { renderLlmsFull, renderLlmsTxt } from '../llms/llms-txt.js'
import { pageMarkdown } from '../llms/markdown.js'
import { createMcpHandler } from '../mcp/http.js'
import { liveDocs } from '../mcp/live.js'
import { SEARCH_INDEX_FILE, SEARCH_VECTORS_FILE, toRoutePath } from '../mcp/source.js'
import { SearchService } from '../search/service.js'
import { newPageSource, pageIdProblem, removeFromSidebar, renameInSidebar, sidebarMentions } from './studio-pages.js'

const STUDIO_PREFIX = '/_shabd/studio/'
export const STUDIO_TOKEN_HEADER = 'x-shabd-studio'

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex')

export function devMiddlewares(context: () => ShabdContext, server: ViteDevServer): Connect.NextHandleFunction {
  const search = new SearchService(context, {
    log: (message) => server.config.logger.warn(`shabd: ${message}`),
  })
  const mcp = createMcpHandler(() => liveDocs(context, search), { origins: 'local' })
  /** Proves a Studio request comes from a page this server sent, not from another site in the same browser. */
  const studioToken = randomUUID()

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const { config, store } = context()
    const { site, features } = config.config
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = stripBase(site.base, url.pathname)
    const method = req.method ?? 'GET'

    if (features.mcp.enabled && path === features.mcp.route) {
      await sendWebResponse(res, await mcp(toWebRequest(req)))
      return true
    }

    if (path.startsWith(STUDIO_PREFIX)) {
      if (!features.studio.enabled) return false
      await handleStudio(req, res, path.slice(STUDIO_PREFIX.length), url)
      return true
    }

    if (method !== 'GET' && method !== 'HEAD') return false

    if (features.llms.enabled && path === '/llms.txt') {
      sendText(res, renderLlmsTxt(context()), 'text/plain; charset=utf-8')
      return true
    }
    if (features.llms.enabled && features.llms.full && path === '/llms-full.txt') {
      sendText(res, renderLlmsFull(context()), 'text/plain; charset=utf-8')
      return true
    }

    if (features.search.enabled && path === `/${SEARCH_INDEX_FILE}`) {
      sendJson(res, (await search.index()).file)
      return true
    }
    if (features.search.enabled && path === `/${SEARCH_VECTORS_FILE}`) {
      const { vectors } = await search.index()
      if (!vectors) return false
      sendText(res, Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength), 'application/octet-stream')
      return true
    }

    if (features.search.enabled && features.search.store === 'sqlite') {
      if (path === `/${SEARCH_FILES.manifest}` || path === `/${SEARCH_FILES.database}`) {
        const database = await search.database()
        if (!database) return false
        if (path.endsWith('.json')) sendJson(res, database.manifest)
        else sendText(res, database.bytes, 'application/vnd.sqlite3')
        return true
      }
    }

    // `/guide/install.md` is the page as Markdown. A browser importing the
    // page's *module* asks for a similar URL, but as a script.
    if (features.llms.enabled && /\.md$/i.test(path) && !url.search && req.headers['sec-fetch-dest'] !== 'script') {
      const page = store.byPath(toRoutePath(path))
      if (page) {
        sendText(res, pageMarkdown(page), 'text/markdown; charset=utf-8')
        return true
      }
    }

    return false
  }

  /* ───────────────────────────── studio ───────────────────────────── */

  const sameOrigin = (req: IncomingMessage): boolean => {
    const site = req.headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin') return false
    const origin = req.headers.origin
    if (origin === undefined) return true
    try {
      return new URL(origin).host === req.headers.host
    } catch {
      return false
    }
  }

  const handleStudio = async (req: IncomingMessage, res: ServerResponse, action: string, url: URL): Promise<void> => {
    const { store, config } = context()
    if (!sameOrigin(req)) {
      sendJson(res, { error: 'The Studio can only be used from the docs site itself.' }, 403)
      return
    }

    if (action === 'session' && req.method === 'GET') {
      sendJson(res, { token: studioToken, contentDir: config.config.content.dir })
      return
    }

    if (req.headers[STUDIO_TOKEN_HEADER] !== studioToken) {
      sendJson(res, { error: 'Missing or stale Studio token. Reload the page.' }, 403)
      return
    }

    if (action === 'source' && req.method === 'GET') {
      const page = store.byId(url.searchParams.get('id') ?? '')
      if (!page) {
        sendJson(res, { error: 'No such page.' }, 404)
        return
      }
      const source = await readFile(page.file, 'utf8')
      sendJson(res, { id: page.id, source, hash: sha1(source) })
      return
    }

    if (action === 'source' && req.method === 'PUT') {
      let body: { id?: unknown; source?: unknown; baseHash?: unknown }
      try {
        body = JSON.parse(await readBody(req)) as typeof body
      } catch {
        sendJson(res, { error: 'Expected a JSON body.' }, 400)
        return
      }
      // Only files that are already pages can be written: the id is looked up, never joined to a path.
      const page = typeof body.id === 'string' ? store.byId(body.id) : undefined
      if (!page || typeof body.source !== 'string') {
        sendJson(res, { error: 'Expected { id, source } for an existing page.' }, 400)
        return
      }
      const onDisk = await readFile(page.file, 'utf8')
      if (body.source === onDisk) {
        // Already what is on disk (another tab saved the same draft): nothing to write.
        sendJson(res, { id: page.id, hash: sha1(onDisk) })
        return
      }
      if (typeof body.baseHash === 'string' && body.baseHash !== sha1(onDisk)) {
        sendJson(res, { error: 'The file changed on disk since it was opened.', source: onDisk, hash: sha1(onDisk) }, 409)
        return
      }
      await writeFile(page.file, body.source)
      // Do not wait for the file watcher: hand the change to the HMR pipeline now.
      server.watcher.emit('change', normalizePath(page.file))
      sendJson(res, { id: page.id, hash: sha1(body.source) })
      return
    }

    /* ── pages: create, rename, delete ── */

    if (action === 'page' && (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE')) {
      let body: { id?: unknown; to?: unknown; title?: unknown }
      try {
        body = JSON.parse(await readBody(req)) as typeof body
      } catch {
        sendJson(res, { error: 'Expected a JSON body.' }, 400)
        return
      }

      /** The file a page id names. Ids are checked first, so this cannot leave the content folder. */
      const fileOf = (id: string) => nodePath.join(config.contentDir, ...id.split('/'))
      const routeOf = (id: string) => slugToPath(fileToSlug(id))
      /** Hand a change to the dev server at once, as a save does, and wait until the page list has caught up. */
      const settle = async (events: ['add' | 'unlink' | 'change', string][], done: () => boolean) => {
        for (const [event, file] of events) server.watcher.emit(event, normalizePath(file))
        for (let waited = 0; waited < 3000 && !done(); waited += 25) await new Promise((resolve) => setTimeout(resolve, 25))
      }
      /** Change the sidebar file, if there is one and the change is one. */
      const editSidebar = async (change: (source: string) => string): Promise<'updated' | 'unchanged'> => {
        if (!existsSync(config.sidebarFile)) return 'unchanged'
        const before = await readFile(config.sidebarFile, 'utf8')
        const after = change(before)
        if (after === before) return 'unchanged'
        await writeFile(config.sidebarFile, after)
        server.watcher.emit('change', normalizePath(config.sidebarFile))
        return 'updated'
      }

      if (req.method === 'POST') {
        const problem = pageIdProblem(body.id)
        if (problem) return void sendJson(res, { error: problem }, 400)
        const id = body.id as string
        const file = fileOf(id)
        if (existsSync(file)) return void sendJson(res, { error: `${id} exists already.` }, 409)
        const taken = store.byPath(routeOf(id))
        if (taken) return void sendJson(res, { error: `${taken.id} is already the page at ${taken.path}.` }, 409)
        await mkdir(nodePath.dirname(file), { recursive: true })
        await writeFile(file, newPageSource(id, typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined), { flag: 'wx' })
        await settle([['add', file]], () => store.byId(id) !== undefined)
        sendJson(res, { id, path: routeOf(id) }, 201)
        return
      }

      const page = typeof body.id === 'string' ? store.byId(body.id) : undefined
      if (!page) return void sendJson(res, { error: 'No such page.' }, 404)

      if (req.method === 'PATCH') {
        const problem = pageIdProblem(body.to)
        if (problem) return void sendJson(res, { error: problem }, 400)
        const to = body.to as string
        if (to === page.id) return void sendJson(res, { id: to, path: page.path, sidebar: 'unchanged' })
        const target = fileOf(to)
        if (existsSync(target)) return void sendJson(res, { error: `${to} exists already.` }, 409)
        const taken = store.byPath(routeOf(to))
        if (taken && taken.id !== page.id) return void sendJson(res, { error: `${taken.id} is already the page at ${taken.path}.` }, 409)
        await mkdir(nodePath.dirname(target), { recursive: true })
        await rename(page.file, target)
        await settle(
          [
            ['unlink', page.file],
            ['add', target],
          ],
          () => store.byId(to) !== undefined && store.byId(page.id) === undefined,
        )
        // The sidebar file follows once the page is known under its new name. Read before that, it
        // would name a page that is not there yet, and the dev server would say so in its log.
        const sidebar = await editSidebar((source) => renameInSidebar(source, page.id, to))
        sendJson(res, { id: to, path: routeOf(to), sidebar })
        return
      }

      await rm(page.file)
      let sidebar: 'updated' | 'unchanged' | 'mentions' = await editSidebar((source) => removeFromSidebar(source, page.id))
      // Where the entry could not be taken out safely, say that it is still there.
      if (existsSync(config.sidebarFile) && sidebarMentions(await readFile(config.sidebarFile, 'utf8'), page.id)) sidebar = 'mentions'
      await settle([['unlink', page.file]], () => store.byId(page.id) === undefined)
      // Read again, the sidebar file gets the warning any entry gets that matches no page, naming its line.
      if (sidebar === 'mentions') server.watcher.emit('change', normalizePath(config.sidebarFile))
      sendJson(res, { id: page.id, sidebar })
      return
    }

    sendJson(res, { error: 'Unknown Studio request.' }, 404)
  }

  return (req, res, next) => {
    handle(req, res).then(
      (handled) => {
        if (!handled) next()
      },
      (error: unknown) => {
        const status = (error as { status?: number }).status
        if (status && !res.headersSent) sendJson(res, { error: (error as Error).message }, status)
        else next(error)
      },
    )
  }
}
