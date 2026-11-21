/**
 * Where the Studio reads and writes page sources. Two backends, one interface:
 *
 *   folder  the File System Access API. The reader picks the content folder
 *           once; from then on the browser writes Markdown files directly to
 *           disk. The dev server is not involved in the write at all.
 *   server  the dev server's Studio endpoint. Used where the File System
 *           Access API does not exist (Firefox, Safari).
 *
 * Either way the write lands in the real file, the dev server notices, and
 * the page hot-updates: the "preview" is the actual page.
 *
 * Both can also make a page, move one and delete one. The dev server checks
 * the path it is sent (src/node/vite/studio-files.ts). In a connected folder
 * there is nobody else to check, so the folder backend holds every path to
 * the same rule before it touches a file.
 */
import {
  IMAGE_BYTES_LIMIT,
  IMAGE_NAME_ATTEMPTS,
  IMAGE_TOO_LARGE,
  imageFileName,
  NOT_AN_IMAGE,
  sniffImage,
  TOO_MANY_IMAGES,
} from '../../shared/image-file.js'
import { pagePathProblem } from '../../shared/page-path.js'
import { withBase } from '../../shared/paths.js'
import { siteStore } from '../app/store.js'

export interface SourceFile {
  source: string
  /** Opaque marker of the file's state when it was read; passed back on write to detect outside edits. */
  version: string
  /** The draft this text was saved from (draft.ts), where the dev server knows: the file was last written by an editor. */
  draft?: string | undefined
}

export class ConflictError extends Error {
  /** The file as it is on disk now. */
  readonly current: SourceFile
  constructor(current: SourceFile) {
    super('The file changed on disk since it was opened.')
    this.current = current
  }
}

export interface StudioBackend {
  kind: 'folder' | 'server'
  /** Shown in the Studio's header. */
  label: string
  read(id: string): Promise<SourceFile>
  /**
   * Throws ConflictError if the file no longer matches `baseVersion`. `draft` names the draft the text is
   * of (draft.ts): the dev server does not count it a conflict when the file was last written by an
   * editor that shares that draft.
   */
  write(id: string, source: string, baseVersion: string, draft?: string): Promise<SourceFile>
  /** Make a page. Throws if the path cannot be a page's, or a file is already there. */
  create(id: string, source: string): Promise<void>
  /** Move a page's file to `to`. Throws if that path cannot be a page's, or a file is already there. */
  rename(id: string, to: string): Promise<void>
  /** Delete a page's file. Throws if the file no longer matches `baseVersion`: it is not what the Studio showed. */
  remove(id: string, baseVersion: string): Promise<void>
  /**
   * Save an image beside a page. `name` is what the image was called and is only a suggestion. Resolves with
   * the name it was saved under. Throws if the bytes are not an image of a kind that is taken, or are too many.
   */
  addImage(id: string, name: string, bytes: Uint8Array<ArrayBuffer>): Promise<string>
}

/* ───────────────────────── dev-server backend ────────────────────────── */

const endpoint = (path: string) => withBase(siteStore.get().site.base, `/_shabd/studio/${path}`)

let session: Promise<Record<string, string>> | undefined

/**
 * What every request to the Studio's endpoints carries: the token that shows
 * it comes from a page of this site. Asked for once. A connected folder
 * writes the files itself, but what the site as a whole looks like is still
 * the dev server's to say, so the token is needed with either backend.
 */
function serverHeaders(): Promise<Record<string, string>> {
  session ??= fetch(endpoint('session'))
    .then(async (response) => {
      if (!response.ok) throw new Error('The dev server did not start a Studio session.')
      const { token } = (await response.json()) as { token: string }
      return { 'content-type': 'application/json', 'x-shabd-studio': token }
    })
    .catch((error: unknown) => {
      // Not kept, so that the next request asks again.
      session = undefined
      throw error
    })
  return session
}

/** Send JSON to an endpoint and read JSON back. A refusal is thrown in the server's own words. */
async function ask<Answer>(path: string, method: string, body?: unknown): Promise<Answer> {
  const response = await fetch(endpoint(path), {
    method,
    headers: await serverHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const answer = (await response.json()) as Answer & { error?: string }
  if (!response.ok) throw new Error(answer.error ?? 'The dev server refused the request.')
  return answer
}

/** Where an offer was left with the dev server, and where the dev server can be reached (src/node/vite/signal.ts). */
export interface Invitation {
  room: string
  local: string[]
  network: string[]
}

/** Leave an offer with the dev server, for the other person's Studio to read and to answer. */
export function openInvitation(offer: string): Promise<Invitation> {
  return ask<Invitation>('signal', 'POST', { offer })
}

/** The answer to an invitation, once there is one. Nothing, when the invitation ran out or was taken back first. */
export async function answerTo(room: string, stop: AbortSignal): Promise<string | undefined> {
  while (!stop.aborted) {
    const response = await fetch(endpoint(`signal/${room}/answer`), { headers: await serverHeaders(), signal: stop })
    if (response.status === 200) return ((await response.json()) as { answer: string }).answer
    // 204 says that nobody has answered yet: the dev server holds a request for so long, and is asked again.
    if (response.status !== 204) return undefined
  }
  return undefined
}

/** Take an invitation back. */
export async function closeInvitation(room: string): Promise<void> {
  await fetch(endpoint(`signal/${room}`), { method: 'DELETE', headers: await serverHeaders() }).catch(() => {})
}

/** The theme as the config has it, and the presets it could start from. */
export interface ThemeNow {
  preset: string
  presets: { name: string; label: string }[]
  colors: Record<string, { light: string; dark: string }>
}

/** What is tried of a theme: another preset, and colours laid over it. */
export interface ThemeChange {
  preset?: string
  colors?: Record<string, { light: string; dark: string }>
}

export interface ThemeTried {
  /** The stylesheet the theme would make. */
  css: string
  colors: ThemeNow['colors']
  /** The lines of the config that say the change. */
  yaml: string
  /** Whether those lines can be put into the config with everything else left as it is. */
  writable: boolean
}

export function themeNow(): Promise<ThemeNow> {
  return ask<ThemeNow>('theme', 'GET')
}

/** What the theme would be with a change made. With `write`, the change is written to the config as well. */
export function tryTheme(change: ThemeChange, write = false): Promise<ThemeTried> {
  return ask<ThemeTried>('theme', 'POST', { ...change, ...(write ? { write: true } : {}) })
}

/** One line of what `shabd check` reports. */
export interface CheckProblem {
  level: 'error' | 'warning' | 'note'
  /** Relative to the site's folder. */
  file: string
  line?: number
  message: string
}

/** What `shabd check` would report as the files are now. The dev server compiles every page to answer. */
export async function checkSite(): Promise<CheckProblem[]> {
  return (await ask<{ problems: CheckProblem[] }>('check', 'GET')).problems
}

/**
 * What a page uses by a path relative to itself and would not find if its file were at `to`: an image beside
 * it, most often. The dev server compiles the page to answer, so it is asked with either backend.
 */
export async function leftBehind(id: string, to: string): Promise<string[]> {
  return (await ask<{ files: string[] }>(`left-behind?id=${encodeURIComponent(id)}&to=${encodeURIComponent(to)}`, 'GET')).files
}

export interface RedirectOffer {
  /** False when the line cannot be put into the config without rewriting part of it. */
  possible: boolean
  /** The line itself, to add by hand when it cannot be added for the author. */
  line: string
  reason?: string
}

/** Can a redirect from an address that a page has left be added to shabd.config.yaml? */
export function redirectOffer(from: string, to: string): Promise<RedirectOffer> {
  return ask(`redirect?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, 'GET')
}

/** Add it. The config is outside the content folder, so this goes through the dev server with either backend. */
export async function addRedirect(from: string, to: string): Promise<void> {
  await ask('redirect', 'POST', { from, to })
}

export async function connectServer(): Promise<StudioBackend> {
  const headers = await serverHeaders()

  return {
    kind: 'server',
    label: 'Saving through the dev server',
    async read(id) {
      const response = await fetch(`${endpoint('source')}?id=${encodeURIComponent(id)}`, { headers })
      if (!response.ok) throw new Error(((await response.json()) as { error: string }).error)
      const file = (await response.json()) as { source: string; hash: string; draft?: string }
      return { source: file.source, version: file.hash, draft: file.draft }
    },
    async write(id, source, baseVersion, draft) {
      const response = await fetch(endpoint('source'), {
        method: 'PUT',
        headers,
        body: JSON.stringify({ id, source, baseHash: baseVersion, ...(draft ? { draft } : {}) }),
      })
      const body = (await response.json()) as { hash?: string; source?: string; error?: string }
      if (response.status === 409 && body.source !== undefined && body.hash) {
        throw new ConflictError({ source: body.source, version: body.hash })
      }
      if (!response.ok || !body.hash) throw new Error(body.error ?? 'The file could not be saved.')
      return { source, version: body.hash }
    },
    async create(id, source) {
      await ask('page', 'POST', { id, source })
    },
    async rename(id, to) {
      await ask('page', 'PATCH', { id, to })
    },
    async remove(id, baseVersion) {
      await ask('page', 'DELETE', { id, baseHash: baseVersion })
    },
    async addImage(id, name, bytes) {
      // The bytes as they are, and not as text inside JSON, which would be a third larger.
      const response = await fetch(`${endpoint('image')}?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        body: bytes,
      })
      const answer = (await response.json()) as { name?: string; error?: string }
      if (!response.ok || !answer.name) throw new Error(answer.error ?? 'The image could not be saved.')
      return answer.name
    },
  }
}

/* ─────────────────────── File System Access backend ──────────────────── */

type PermissionMode = { mode: 'readwrite' }
interface DirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options: PermissionMode): Promise<PermissionState>
  requestPermission(options: PermissionMode): Promise<PermissionState>
}
type DirectoryPicker = (options: { id: string; mode: 'readwrite' }) => Promise<DirectoryHandle>

const picker = (): DirectoryPicker | undefined =>
  (globalThis as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker

export const folderAccessSupported = (): boolean => picker() !== undefined

/** The folder a file is in, and the file's name there. With `make`, folders that are missing are made. */
async function folderOf(
  root: FileSystemDirectoryHandle,
  id: string,
  make = false,
): Promise<{ directory: FileSystemDirectoryHandle; name: string }> {
  const segments = id.split('/')
  const name = segments.pop()!
  let directory = root
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: make })
  return { directory, name }
}

async function fileIn(root: FileSystemDirectoryHandle, id: string): Promise<FileSystemFileHandle> {
  const { directory, name } = await folderOf(root, id)
  return directory.getFileHandle(name)
}

/** Is anything called `name` in a folder: a file, or a folder? */
async function isTaken(directory: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await directory.getFileHandle(name)
    return true
  } catch (error) {
    // A folder has the name. That is taken too.
    if ((error as DOMException).name === 'TypeMismatchError') return true
    if ((error as DOMException).name === 'NotFoundError') return false
    throw error
  }
}

/** Only a page the site knows is moved or deleted, as with the dev server: never some other file in the folder. */
function assertPage(id: string): void {
  const known = Object.values(siteStore.get().pagesInDev ?? {}).some((page) => page.id === id)
  if (!known) throw new Error('There is no page with that name.')
}

function folderBackend(root: DirectoryHandle): StudioBackend {
  const read = async (id: string): Promise<SourceFile> => {
    const file = await (await fileIn(root, id)).getFile()
    return { source: await file.text(), version: String(file.lastModified) }
  }
  /** Make a file that is not there yet. The browser cannot be told to refuse a name that is taken, so that is looked up first. */
  const create = async (id: string, source: string): Promise<void> => {
    const problem = pagePathProblem(id)
    if (problem) throw new Error(problem)
    const { directory, name } = await folderOf(root, id, true)
    if (await isTaken(directory, name)) throw new Error(`There is already a file at ${id}.`)
    const writable = await (await directory.getFileHandle(name, { create: true })).createWritable()
    await writable.write(source)
    await writable.close()
  }
  return {
    kind: 'folder',
    label: `Writing to the “${root.name}” folder on this device`,
    read,
    async write(id, source, baseVersion) {
      const handle = await fileIn(root, id)
      const current = await handle.getFile()
      if (String(current.lastModified) !== baseVersion) {
        const onDisk = await current.text()
        // Changed since it was read, but to the same text: nothing to write.
        if (onDisk === source) return { source, version: String(current.lastModified) }
        throw new ConflictError({ source: onDisk, version: String(current.lastModified) })
      }
      const writable = await handle.createWritable()
      await writable.write(source)
      await writable.close()
      return { source, version: String((await handle.getFile()).lastModified) }
    },
    create,
    async rename(id, to) {
      assertPage(id)
      const { directory, name } = await folderOf(root, id)
      const text = await (await (await directory.getFileHandle(name)).getFile()).text()
      // The new file first, and the old one only once that is written: the page is never in neither place.
      await create(to, text)
      await directory.removeEntry(name)
    },
    async remove(id, baseVersion) {
      assertPage(id)
      const { directory, name } = await folderOf(root, id)
      // `getFileHandle` refuses a folder, so this cannot take one away.
      const current = await (await directory.getFileHandle(name)).getFile()
      if (String(current.lastModified) !== baseVersion) throw new Error('The file changed on disk since it was opened.')
      await directory.removeEntry(name)
    },
    async addImage(id, name, bytes) {
      assertPage(id)
      // What the dev server would check, checked here: there is nobody else to.
      if (bytes.length > IMAGE_BYTES_LIMIT) throw new Error(IMAGE_TOO_LARGE)
      const kind = sniffImage(bytes)
      if (!kind) throw new Error(NOT_AN_IMAGE)
      const { directory } = await folderOf(root, id)
      for (let attempt = 1; attempt <= IMAGE_NAME_ATTEMPTS; attempt++) {
        const fileName = imageFileName(name, kind, attempt)
        if (await isTaken(directory, fileName)) continue
        const writable = await (await directory.getFileHandle(fileName, { create: true })).createWritable()
        await writable.write(bytes)
        await writable.close()
        return fileName
      }
      throw new Error(TOO_MANY_IMAGES)
    },
  }
}

/**
 * Ask for the content folder and check it is the right one, by looking for
 * the page being edited inside it. Must be called from a click.
 */
export async function connectFolder(pageId: string): Promise<StudioBackend> {
  const pick = picker()
  if (!pick) throw new Error('This browser cannot open folders. The Studio will save through the dev server instead.')
  const root = await pick({ id: 'shabd-content', mode: 'readwrite' })
  try {
    await fileIn(root, pageId)
  } catch {
    const expected = siteStore.get().contentDir
    throw new Error(`“${root.name}” does not contain ${pageId}. Choose this site's “${expected}” folder.`)
  }
  await rememberFolder(root)
  return folderBackend(root)
}

/** The folder chosen on an earlier visit, if the browser still allows writing to it without asking. */
export async function restoreFolder(): Promise<StudioBackend | null> {
  try {
    const root = await recallFolder()
    if (!root || (await root.queryPermission({ mode: 'readwrite' })) !== 'granted') return null
    return folderBackend(root)
  } catch {
    return null
  }
}

/* Directory handles are structured-cloneable, so IndexedDB can keep one between visits. */

const DATABASE = 'shabd-studio'
const STORE = 'handles'
const KEY = () => `content:${siteStore.get().site.base}`

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function rememberFolder(handle: DirectoryHandle): Promise<void> {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(handle, KEY())
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  }).finally(() => db.close())
}

async function recallFolder(): Promise<DirectoryHandle | undefined> {
  const db = await database()
  return new Promise<DirectoryHandle | undefined>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY())
    request.onsuccess = () => resolve(request.result as DirectoryHandle | undefined)
    request.onerror = () => reject(request.error)
  }).finally(() => db.close())
}
