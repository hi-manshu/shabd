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
 */
import { withBase } from '../../shared/paths.js'
import { siteStore } from '../app/store.js'

export interface SourceFile {
  source: string
  /** Opaque marker of the file's state when it was read; passed back on write to detect outside edits. */
  version: string
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
  /** Throws ConflictError if the file no longer matches `baseVersion`. */
  write(id: string, source: string, baseVersion: string): Promise<SourceFile>
}

/* ───────────────────────── dev-server backend ────────────────────────── */

const endpoint = (path: string) => withBase(siteStore.get().site.base, `/_shabd/studio/${path}`)

export async function connectServer(): Promise<StudioBackend> {
  const session = await fetch(endpoint('session'))
  if (!session.ok) throw new Error('The dev server did not start a Studio session.')
  const { token } = (await session.json()) as { token: string }
  const headers = { 'content-type': 'application/json', 'x-shabd-studio': token }

  return {
    kind: 'server',
    label: 'Saving through the dev server',
    async read(id) {
      const response = await fetch(`${endpoint('source')}?id=${encodeURIComponent(id)}`, { headers })
      if (!response.ok) throw new Error(((await response.json()) as { error: string }).error)
      const file = (await response.json()) as { source: string; hash: string }
      return { source: file.source, version: file.hash }
    },
    async write(id, source, baseVersion) {
      const response = await fetch(endpoint('source'), {
        method: 'PUT',
        headers,
        body: JSON.stringify({ id, source, baseHash: baseVersion }),
      })
      const body = (await response.json()) as { hash?: string; source?: string; error?: string }
      if (response.status === 409 && body.source !== undefined && body.hash) {
        throw new ConflictError({ source: body.source, version: body.hash })
      }
      if (!response.ok || !body.hash) throw new Error(body.error ?? 'The file could not be saved.')
      return { source, version: body.hash }
    },
  }
}

/* ───────────────────────────────── pages ─────────────────────────────── */

/**
 * Creating, renaming and deleting pages. These always go through the dev
 * server, also when a folder is connected: the server moves the file, keeps
 * `sidebar.yaml` in step, and knows the address the page ends up at.
 */
export interface StudioPages {
  /** `id` is the page's path under the content folder, with its extension. */
  create(id: string): Promise<{ id: string; path: string }>
  rename(id: string, to: string): Promise<{ id: string; path: string; sidebar: 'updated' | 'unchanged' }>
  /** `mentions`: the page is gone, and the sidebar file still lists it. */
  remove(id: string): Promise<{ sidebar: 'updated' | 'unchanged' | 'mentions' }>
}

export async function connectPages(): Promise<StudioPages> {
  const session = await fetch(endpoint('session'))
  if (!session.ok) throw new Error('The dev server did not start a Studio session.')
  const { token } = (await session.json()) as { token: string }
  const send = async <T>(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, string>): Promise<T> => {
    const response = await fetch(endpoint('page'), {
      method,
      headers: { 'content-type': 'application/json', 'x-shabd-studio': token },
      body: JSON.stringify(body),
    })
    const answer = (await response.json()) as T & { error?: string }
    if (!response.ok) throw new Error(answer.error ?? 'The dev server refused.')
    return answer
  }
  return {
    create: (id) => send('POST', { id }),
    rename: (id, to) => send('PATCH', { id, to }),
    remove: (id) => send('DELETE', { id }),
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

async function fileIn(root: FileSystemDirectoryHandle, id: string): Promise<FileSystemFileHandle> {
  const segments = id.split('/')
  const name = segments.pop()!
  let directory = root
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment)
  return directory.getFileHandle(name)
}

function folderBackend(root: DirectoryHandle): StudioBackend {
  const read = async (id: string): Promise<SourceFile> => {
    const file = await (await fileIn(root, id)).getFile()
    return { source: await file.text(), version: String(file.lastModified) }
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
