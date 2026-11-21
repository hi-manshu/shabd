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
import { createReadStream, existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path, { extname } from 'node:path'
import { normalizePath, type Connect, type ViteDevServer } from 'vite'
import { IMAGE_BYTES_LIMIT, IMAGE_TOO_LARGE } from '../../shared/image-file.js'
import { leftBehindProblem, pagePathProblem, pageRoute } from '../../shared/page-path.js'
import { stripBase } from '../../shared/paths.js'
import { SEARCH_FILES } from '../../shared/search-core.js'
import { FEED_FILE, renderFeed } from '../build/feed.js'
import { collectProblems, type Problem } from '../check.js'
import { planRedirect } from '../config/redirect-edit.js'
import type { PageRecord } from '../content/store.js'
import type { ShabdContext } from '../context.js'
import { readBody, readBytes, sendJson, sendText, sendWebResponse, toWebRequest } from '../http.js'
import { renderLlmsFull, renderLlmsTxt } from '../llms/llms-txt.js'
import { pageMarkdown } from '../llms/markdown.js'
import { createMcpHandler } from '../mcp/http.js'
import { liveDocs } from '../mcp/live.js'
import { SEARCH_INDEX_FILE, SEARCH_VECTORS_FILE, toRoutePath } from '../mcp/source.js'
import { modelFiles, runtimeFiles } from '../search/model-files.js'
import { SearchService } from '../search/service.js'
import { createPage, deletePage, movePage, relativeImports, saveImage, StudioRefusal } from './studio-files.js'

const STUDIO_PREFIX = '/_shabd/studio/'

/** What the model's and the runtime's files are sent as. A browser compiles WebAssembly as it arrives only under its own type. */
const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
}
export const STUDIO_TOKEN_HEADER = 'x-shabd-studio'
/** Longer than the file watcher takes to find a file that has just been made. */
const WATCHER_HAS_SEEN_MS = 500

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

    if (features.feed.enabled && path === `/${FEED_FILE}`) {
      sendText(res, renderFeed(context()), 'application/rss+xml; charset=utf-8')
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

    if (features.search.enabled && features.search.modelSource === 'site') {
      // What a build copies into the output is served here from where it lies: the model from the cache
      // Transformers.js downloaded it into, and the runtime from node_modules.
      const sets = [
        {
          folder: `/${SEARCH_FILES.models}`,
          // The model is in the cache once the index has been built with it. An index without vectors has no model.
          files: async () => {
            const { semantic } = (await search.index()).file
            return semantic ? modelFiles(semantic.model, config.root) : []
          },
        },
        { folder: `/${SEARCH_FILES.runtime}`, files: () => runtimeFiles(config.root) },
      ]
      for (const { folder, files } of sets) {
        if (!path.startsWith(folder)) continue
        // The file is looked up by name among the few that are served. The request's path is never joined to a folder.
        const name = path.slice(folder.length)
        const served = (await files()).find((file) => file.name === name || encodeURI(file.name) === name)
        if (!served) return false
        // Transformers.js asks for a file's first byte to learn its size before it asks for the file.
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
        const last = served.bytes - 1
        const start = range ? Number(range[1]) : 0
        const end = range?.[2] ? Math.min(Number(range[2]), last) : last
        const partial = range !== null && start <= end
        res.statusCode = partial ? 206 : 200
        if (partial) res.setHeader('Content-Range', `bytes ${start}-${end}/${served.bytes}`)
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Type', CONTENT_TYPES[extname(served.name)] ?? 'application/octet-stream')
        res.setHeader('Content-Length', partial ? end - start + 1 : served.bytes)
        res.setHeader('Cache-Control', 'no-cache')
        if (method === 'HEAD') res.end()
        else createReadStream(served.file, partial ? { start, end } : {}).pipe(res)
        return true
      }
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

  /**
   * The draft a page was last saved from, and the text that was saved, by its hash. Editors that share a
   * draft each save it, and each knows the file as it was when that editor last wrote or read it. A save
   * from one of them over a save from another is the same text a moment further on, and not a change
   * from outside. Only the last save counts: a file that another program has set back to a text the
   * draft once had is a change from outside like any other, and is not written over.
   */
  const writtenBy = new Map<string, { draft: string; hash: string }>()
  /** The draft that the text on disk was saved from, when the last save of the page is what is on disk still. */
  const draftOf = (page: string, hash: string): string | undefined => {
    const last = writtenBy.get(page)
    return last?.hash === hash ? last.draft : undefined
  }

  /**
   * One at a time for each file. A save reads the file, compares it with what the editor last saw, and
   * writes. Editors that share a draft each save it, so two saves of one file arrive together, and the
   * second would read the file while the first was writing it: empty, or half of what it will be.
   */
  const turns = new Map<string, Promise<void>>()
  const inTurn = <T>(file: string, run: () => Promise<T>): Promise<T> => {
    const mine = (turns.get(file) ?? Promise.resolve()).then(run)
    const done = mine.then(
      () => {},
      () => {},
    )
    turns.set(file, done)
    void done.then(() => {
      if (turns.get(file) === done) turns.delete(file)
    })
    return mine
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
      const source = await inTurn(page.file, () => readFile(page.file, 'utf8'))
      const hash = sha1(source)
      // An editor that reads the file again is told when what it reads was saved from a draft: if that is
      // the draft it holds, the file has nothing to tell it that the draft will not.
      const from = draftOf(page.id, hash)
      sendJson(res, { id: page.id, source, hash, ...(from ? { draft: from } : {}) })
      return
    }

    if (action === 'source' && req.method === 'PUT') {
      let body: { id?: unknown; source?: unknown; baseHash?: unknown; draft?: unknown }
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
      // A page made from an OpenAPI description is written again whenever the description changes.
      if (page.generated) {
        sendJson(res, { error: `This page is made from ${page.generated}. Change the description, and the page follows.` }, 403)
        return
      }
      const source = body.source
      const draft = typeof body.draft === 'string' && body.draft.length <= 64 ? body.draft : undefined
      await inTurn(page.file, async () => {
        const onDisk = await readFile(page.file, 'utf8')
        const diskHash = sha1(onDisk)
        if (source === onDisk) {
          // Already what is on disk (another editor saved the same draft): nothing to write.
          if (draft) writtenBy.set(page.id, { draft, hash: diskHash })
          sendJson(res, { id: page.id, hash: diskHash })
          return
        }
        // Not what this editor last saw. It is still no conflict if an editor that shares its draft wrote it.
        if (typeof body.baseHash === 'string' && body.baseHash !== diskHash && !(draft && draftOf(page.id, diskHash) === draft)) {
          sendJson(res, { error: 'The file changed on disk since it was opened.', source: onDisk, hash: diskHash }, 409)
          return
        }
        if (draft) writtenBy.set(page.id, { draft, hash: sha1(source) })
        else writtenBy.delete(page.id)
        await writeFile(page.file, source)
        // Do not wait for the file watcher: hand the change to the HMR pipeline now.
        server.watcher.emit('change', normalizePath(page.file))
        sendJson(res, { id: page.id, hash: sha1(source) })
      })
      return
    }

    /*
     * Making, moving and deleting pages. A page that exists is still found by
     * its name. The place of a new one is a path from the request, and what
     * that path may be is settled in studio-files.ts.
     */

    /** Two files with one address cannot both be served: a new file may not take the address of a page that is there. */
    const refuseTakenAddress = (id: string, moving?: PageRecord) => {
      const other = store.byPath(pageRoute(id))
      if (other && other !== moving) throw new StudioRefusal(`${other.id} already has the address ${other.path}.`, 409)
    }
    /** A path that could be a page's, or a refusal that says what is wrong with it. */
    const newPlace = (id: unknown): string => {
      const problem = pagePathProblem(id)
      if (problem) throw new StudioRefusal(problem, 400)
      return id as string
    }
    const existingPage = (id: unknown): PageRecord => {
      const page = typeof id === 'string' ? store.byId(id) : undefined
      if (!page) throw new StudioRefusal('There is no page with that name.', 404)
      // A page made from an OpenAPI description is written again whenever the description changes:
      // moved or deleted, it would come back where it was.
      if (page.generated) throw new StudioRefusal(`This page is made from ${page.generated}. Change the description, and the page follows.`, 403)
      return page
    }
    /**
     * What a page uses by a path relative to itself, and would not find if its file were at `to`: an image
     * beside it, most often. A page whose image is missing is not served at all, so the Studio could not be
     * opened on it to mend it, and such a move is refused. Vite's own resolver is asked, because that is what
     * decides it when the page is served.
     *
     * The page is compiled as it will be at `to`. That is kept, so the work is done before the file moves
     * and the browser is not left waiting for the page at its new address.
     */
    const leftBehind = async (page: PageRecord, to: string): Promise<string[]> => {
      // A page that does not compile shows what is wrong with it, wherever its file is.
      if (page.error) return []
      const file = path.join(config.contentDir, to)
      let code: string
      try {
        // The file as it is on disk. With a connected folder the browser saved it a moment ago, and the
        // watcher may not have told the store yet.
        const source = await inTurn(page.file, () => readFile(page.file, 'utf8'))
        const compiled = await context().compiler.compile({
          file,
          source,
          format: /\.mdx$/i.test(to) ? 'mdx' : 'md',
          id: to,
          routePath: pageRoute(to),
          hash: sha1(source),
          liftTitle: page.titleFromHeading,
        })
        code = compiled.code
      } catch {
        return []
      }
      if (path.dirname(file) === path.dirname(page.file)) return []
      const { pluginContainer } = server.environments.client
      const found = async (specifier: string, from: string) => (await pluginContainer.resolveId(specifier, from)) !== null
      const lost: string[] = []
      for (const specifier of relativeImports(code)) {
        if ((await found(specifier, page.file)) && !(await found(specifier, file))) lost.push(specifier)
      }
      return lost
    }
    /**
     * The watcher finds a new file in its own time, a tenth of a second or so, and the page is listed here
     * without waiting for it. A file that is deleted on disk before the watcher has found it is one the
     * watcher never saw: it does not say that the file has gone, and the page stayed listed until the dev
     * server stopped. So a file made here is looked at once more, when the watcher has had its time.
     */
    const lookAgain = (file: string) => {
      setTimeout(() => {
        if (!existsSync(file) && context().store.byFile(file)) server.watcher.emit('unlink', normalizePath(file))
      }, WATCHER_HAS_SEEN_MS).unref()
    }

    if (action === 'page' && req.method === 'POST') {
      const body = await jsonBody(req)
      const id = newPlace(body.id)
      if (typeof body.source !== 'string') throw new StudioRefusal('Expected { id, source }.', 400)
      refuseTakenAddress(id)
      const file = await createPage(config.contentDir, id, body.source)
      // As for a save: the routes and the navigation follow now, not when the watcher gets to it.
      server.watcher.emit('add', normalizePath(file))
      lookAgain(file)
      sendJson(res, { id, path: pageRoute(id) }, 201)
      return
    }

    if (action === 'page' && req.method === 'PATCH') {
      const body = await jsonBody(req)
      const page = existingPage(body.id)
      const to = newPlace(body.to)
      if (to === page.id) throw new StudioRefusal('That is the name the page has.', 400)
      refuseTakenAddress(to, page)
      const lost = await leftBehind(page, to)
      if (lost.length > 0) throw new StudioRefusal(leftBehindProblem(to, lost), 409)
      const file = await movePage(config.contentDir, page.file, to)
      // One hot update for the move, not one for each file. The new file is entered here, and the update that
      // follows the removal of the old one carries both: the browser's list of pages goes from the old state
      // to the new one, with no state in between in which the page is in two places or in none.
      await store.upsert(file)
      server.watcher.emit('unlink', normalizePath(page.file))
      lookAgain(file)
      sendJson(res, { id: to, path: pageRoute(to), from: page.path })
      return
    }

    // What a page would lose by a move, asked before it. The Studio asks with either backend: in a connected
    // folder the browser moves the file itself, and only the dev server, which compiles the page, can say.
    if (action === 'left-behind' && req.method === 'GET') {
      const page = existingPage(url.searchParams.get('id'))
      const to = newPlace(url.searchParams.get('to'))
      sendJson(res, { files: await leftBehind(page, to) })
      return
    }

    if (action === 'page' && req.method === 'DELETE') {
      const body = await jsonBody(req)
      const page = existingPage(body.id)
      // What is deleted is what the Studio last showed, not something written to the file since.
      await inTurn(page.file, async () => {
        if (typeof body.baseHash === 'string' && body.baseHash !== sha1(await readFile(page.file, 'utf8'))) {
          throw new StudioRefusal('The file changed on disk since it was opened.', 409)
        }
        await deletePage(page.file)
      })
      server.watcher.emit('unlink', normalizePath(page.file))
      sendJson(res, { id: page.id })
      return
    }

    // An image pasted or dropped into the editor, as the bytes of the request. The page it goes beside is found
    // by its name; what the image is called is only a suggestion, and what it is, is read from the bytes.
    if (action === 'image' && req.method === 'POST') {
      const page = existingPage(url.searchParams.get('id'))
      // Refused by its stated size before any of it is read, and by its real size while it is.
      if (Number(req.headers['content-length']) > IMAGE_BYTES_LIMIT) throw new StudioRefusal(IMAGE_TOO_LARGE, 413)
      const bytes = await readBytes(req, IMAGE_BYTES_LIMIT).catch((error: unknown) => {
        throw (error as { status?: number }).status === 413 ? new StudioRefusal(IMAGE_TOO_LARGE, 413) : error
      })
      const name = await saveImage(config.contentDir, page.file, url.searchParams.get('name'), bytes)
      sendJson(res, { name }, 201)
      return
    }

    // What `shabd check` reports as things stand. The Studio asks before and after it moves a page, and shows what is new.
    if (action === 'check' && req.method === 'GET') {
      const { problems, detailed } = await collectProblems(context())
      const broken: Problem[] = detailed.flatMap((error) =>
        error.issues.map((issue) => ({
          level: 'error' as const,
          rule: 'page',
          file: path.relative(config.root, error.file),
          line: issue.line,
          message: issue.message,
        })),
      )
      sendJson(res, { problems: [...broken, ...problems] })
      return
    }

    // The one thing the Studio writes outside the content folder: a line under `redirects:` in the config.
    if (action === 'redirect' && (req.method === 'GET' || req.method === 'POST')) {
      const asked = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await jsonBody(req)
      const plan = planRedirect(config, await readFile(config.configFile, 'utf8'), asked.from, asked.to, (route) => store.byPath(route) !== undefined)
      if (req.method === 'GET') {
        // Asked first, so that the Studio only offers what it can do.
        sendJson(res, plan.ok ? { possible: true, line: plan.line } : { possible: false, line: plan.line, reason: plan.problem })
        return
      }
      if (!plan.ok) throw new StudioRefusal(plan.problem, 409)
      await writeFile(config.configFile, plan.source)
      // Readers are sent on from the old address as soon as this answers. The watcher brings the file in
      // as well a moment later, and finds the same config.
      const running = context()
      running.config = plan.config
      running.store.setConfig(plan.config)
      sendJson(res, { line: plan.line })
      return
    }

    sendJson(res, { error: 'Unknown Studio request.' }, 404)
  }

  /** The body of a request as a JSON object. */
  const jsonBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const text = await readBody(req)
    try {
      const body: unknown = JSON.parse(text)
      if (typeof body === 'object' && body !== null && !Array.isArray(body)) return body as Record<string, unknown>
    } catch {
      // Not JSON: refused below.
    }
    throw new StudioRefusal('Expected a JSON object as the body.', 400)
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
