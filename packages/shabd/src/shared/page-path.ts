/**
 * Which paths may be a page's file.
 *
 * The Studio makes and moves pages, so for once a path comes from outside:
 * typed into a form, or sent to the dev server. This is the one definition
 * of a path that is acceptable. The dev server holds what it is sent to it;
 * the browser holds a name to it while it is being typed, and before it
 * writes into a connected folder itself.
 *
 * It judges the text of the path and nothing else. Whether the path still
 * lies inside the content folder once symbolic links are followed, and
 * whether a file is already there, only the file system can say
 * (src/node/vite/studio-files.ts).
 */
import { fileToSlug, isPageFile, slugToPath } from './paths.js'

/** Longer than any real page's path, and short enough to show in a message. */
const LONGEST_PATH = 512

/** Characters that are not allowed in a file name on one system or another. */
const UNSAFE_CHARACTERS = /[<>:"|?*]/

/**
 * What is wrong with `path` as the place of a page, in words for the person
 * who typed it. Undefined when nothing is.
 *
 * A path that passes is relative, uses forward slashes, names an .md or
 * .mdx file, and has no part that is empty, `.` or `..`, or that starts
 * with `_` or `.`. So it cannot climb out of the folder it is joined to, and
 * the file it names is one the content store takes for a page.
 */
export function pagePathProblem(path: unknown): string | undefined {
  if (typeof path !== 'string' || path.trim() === '') return 'Give the file a name, such as guide/new-page.md.'
  if (path.length > LONGEST_PATH) return `That path is longer than ${LONGEST_PATH} characters.`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return 'A file name cannot contain a line break or another control character.'
  if (path.includes('\\')) return 'Write folders with a forward slash, as in guide/new-page.md.'
  // `C:name.md` is a path on another drive to Windows, and `:` is refused below in any case.
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return 'Give a path inside the content folder, such as guide/new-page.md, not one that starts from the root of the disk.'
  }

  for (const part of path.split('/')) {
    if (part === '') return 'A path cannot have an empty part. Look for a slash at either end, or two together.'
    if (part === '.' || part === '..') return 'A path cannot contain "." or "..". Name the folder the page is in.'
    // The content store reads such files and folders as partials and private notes, never as pages.
    if (part.startsWith('.') || part.startsWith('_')) return `"${part}" starts with "${part[0]}", and a file or folder that does is not a page.`
    if (UNSAFE_CHARACTERS.test(part)) return `"${part}" contains one of < > : " | ? *, which a file name cannot hold on every system.`
    if (part !== part.trim() || part.endsWith('.')) return `"${part}" starts or ends with a space, or ends with a full stop.`
  }

  if (!isPageFile(path)) return 'A page is a file whose name ends in .md or .mdx.'
  return undefined
}

/** The address of the page a file is, as the content store works it out: `guide/Getting Started.md` → `/guide/getting-started`. */
export function pageRoute(path: string): string {
  return slugToPath(fileToSlug(path))
}

/**
 * What is said when a page is not moved to `to`, because from there it
 * would not find `files`: what it uses by a path relative to itself, such as
 * an image beside it. A page whose image is missing cannot be shown at all,
 * and the Studio could not be opened on it to mend it.
 */
export function leftBehindProblem(to: string, files: string[]): string {
  const folder = to.includes('/') ? `${to.slice(0, to.lastIndexOf('/'))}/` : 'the content folder'
  const list = files.length > 1 ? `${files.slice(0, -1).join(', ')} and ${files.at(-1)}` : files[0]
  return (
    `From ${folder} the page would not find ${list}, which it uses where it is now. ` +
    'The Studio moves the page and nothing else. Move the page and what it uses together outside the Studio, or keep the page in its folder.'
  )
}
