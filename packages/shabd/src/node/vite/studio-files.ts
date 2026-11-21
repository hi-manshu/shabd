/**
 * What the Studio may do to files besides writing to a page that exists:
 * make a page, move one, delete one, and save an image beside one.
 *
 * A page that exists is found by its name in the content store, and no path
 * is taken from the request. A page that is to be made, or the new place of
 * one that moves, has no entry to find: there a path does come from outside.
 * Every way it could lead somewhere else is closed here.
 *
 *   The text of the path   No `..`, nothing absolute, an .md or .mdx file,
 *                          no part that starts with `_` or `.`
 *                          (shared/page-path.ts).
 *   Where it leads         The folder it names, with every symbolic link
 *                          followed, is inside the content folder.
 *   What is there already  The file is made in a way the system refuses if
 *                          anything has that name, a symbolic link included.
 *                          Nothing is ever written over.
 */
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
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

/** A request the Studio's endpoints turn down, with the HTTP status that says how. */
export class StudioRefusal extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const isInside = (folder: string, file: string) => file === folder || file.startsWith(folder + path.sep)

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code

async function isThere(file: string): Promise<boolean> {
  try {
    // `lstat` does not follow a link, so a link that leads nowhere still counts as something being there.
    await lstat(file)
    return true
  } catch {
    return false
  }
}

/**
 * The absolute path that `id` names inside the content folder, once it is
 * certain to be inside it. The folders on the way are made if they are
 * missing.
 */
async function placeFor(contentDir: string, id: unknown): Promise<string> {
  const problem = pagePathProblem(id)
  if (problem) throw new StudioRefusal(problem, 400)

  const target = path.join(contentDir, ...(id as string).split('/'))
  const outside = new StudioRefusal('That path leads out of the content folder.', 400)
  // Already ruled out by the check above. This one costs nothing and does not depend on it.
  if (!isInside(path.resolve(contentDir), path.resolve(target))) throw outside

  const root = await realpath(contentDir)
  const folder = path.dirname(target)
  // The deepest folder on the way that exists. A link among those could lead anywhere; what is below them is made here, as plain folders.
  let existing = folder
  while (!(await isThere(existing))) existing = path.dirname(existing)
  let resolved: string
  try {
    resolved = await realpath(existing)
  } catch {
    throw outside
  }
  if (!isInside(root, resolved)) throw outside
  if (!(await stat(resolved)).isDirectory()) {
    throw new StudioRefusal(`${path.relative(contentDir, existing).split(path.sep).join('/')} is a file, so nothing can be put inside it.`, 400)
  }

  await mkdir(folder, { recursive: true })
  // Asked again now that the folders are there, in case one was swapped for a link in between.
  if (!isInside(root, await realpath(folder))) throw outside
  return target
}

const taken = (id: string) => new StudioRefusal(`There is already a file at ${id}.`, 409)

/** Make a new page. Refuses if anything is already at that path. Returns the file's absolute path. */
export async function createPage(contentDir: string, id: unknown, source: string): Promise<string> {
  const file = await placeFor(contentDir, id)
  try {
    // `wx`: make the file, and fail if the name is taken. The system does both in one step, and does not follow a link that has the name.
    await writeFile(file, source, { flag: 'wx' })
  } catch (error) {
    if (codeOf(error) === 'EEXIST') throw taken(id as string)
    throw error
  }
  return file
}

/**
 * Move a page's file to a new path inside the content folder. `from` is the
 * file of a page the store knows. Refuses if anything is already at the new
 * path. Returns the new absolute path.
 */
export async function movePage(contentDir: string, from: string, id: unknown): Promise<string> {
  const to = await placeFor(contentDir, id)
  try {
    // Not `rename`, which replaces whatever is at the new name without a word. This copy refuses instead.
    await copyFile(from, to, constants.COPYFILE_EXCL)
  } catch (error) {
    if (codeOf(error) === 'EEXIST') throw taken(id as string)
    throw error
  }
  try {
    await unlink(from)
  } catch (error) {
    // The page must not end up in two places. The copy is ours, made a moment ago.
    await unlink(to).catch(() => {})
    throw error
  }
  return to
}

/** Delete a page's file. `file` is the file of a page the store knows; `unlink` removes a file and refuses a folder. */
export async function deletePage(file: string): Promise<void> {
  await unlink(file)
}

/**
 * Save an image beside a page, and return the name it was given.
 * `pageFile` is the file of a page the store knows.
 *
 * Nothing that was sent decides where the file goes or what it is. The
 * folder is the page's own. The kind is read from the first bytes, and
 * what is not one of a few kinds of image is refused. The name is made
 * here from what the image was called (shared/image-file.ts): letters,
 * digits and hyphens, and the extension of what the file is. A name that
 * is taken is not written over: the next free one is used.
 */
export async function saveImage(contentDir: string, pageFile: string, suggested: unknown, bytes: Uint8Array): Promise<string> {
  if (bytes.length > IMAGE_BYTES_LIMIT) throw new StudioRefusal(IMAGE_TOO_LARGE, 413)
  const kind = sniffImage(bytes)
  if (!kind) throw new StudioRefusal(NOT_AN_IMAGE, 415)

  const folder = path.dirname(pageFile)
  // The store finds pages by walking the content folder, which does not go through links. The watcher that
  // tells it of new files does, so a page can be known that is somewhere else on disk. Not for this.
  if (!isInside(await realpath(contentDir), await realpath(folder))) {
    throw new StudioRefusal('That page is in a folder that leads out of the content folder.', 400)
  }

  for (let attempt = 1; attempt <= IMAGE_NAME_ATTEMPTS; attempt++) {
    const name = imageFileName(suggested, kind, attempt)
    try {
      await writeFile(path.join(folder, name), bytes, { flag: 'wx' })
      return name
    } catch (error) {
      if (codeOf(error) !== 'EEXIST') throw error
    }
  }
  throw new StudioRefusal(TOO_MANY_IMAGES, 409)
}
