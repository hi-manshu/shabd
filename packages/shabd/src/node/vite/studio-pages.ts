/**
 * What the Studio needs to create, rename and delete pages: which paths may
 * be pages, what a new page starts with, and how `sidebar.yaml` follows a
 * page that moved or went.
 *
 * Nothing here touches the disk. The dev server's Studio endpoint does that
 * (dev-middleware.ts), and these are the decisions it makes on the way.
 */
import { isMap, isScalar, isSeq, parseDocument, type Node } from 'yaml'
import { isPageFile, refToSlug } from '../../shared/paths.js'

/** Why this cannot be the path of a page, or undefined when it can. The path is relative to the content folder. */
export function pageIdProblem(id: unknown): string | undefined {
  if (typeof id !== 'string' || id.trim() === '') return 'Give the page a path, such as guide/new-page.md.'
  if (id.length > 200) return 'That path is too long.'
  if (id.includes('\\')) return 'Write the path with forward slashes.'
  for (const segment of id.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      return 'The path has to stay inside the content folder: no leading slash, no empty part, no "..".'
    }
    if (segment.startsWith('_') || segment.startsWith('.')) {
      return `"${segment}" starts with "${segment[0]}". Files and folders that do are not pages.`
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) {
      return `"${segment}" has a character a page path cannot have. Use letters, digits, hyphens, underscores and dots.`
    }
  }
  if (!isPageFile(id)) return 'A page is a .md or .mdx file.'
  return undefined
}

/** `guide/new-page.md` → "New page". */
export function titleFromId(id: string): string {
  const name = id.slice(id.lastIndexOf('/') + 1).replace(/\.mdx?$/i, '')
  const words = (name.toLowerCase() === 'index' ? id.split('/').at(-2) ?? 'Home' : name).replace(/[-_.]+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Untitled'
}

/** What a page created from the Studio holds: a title, and a line to replace. */
export function newPageSource(id: string, title = titleFromId(id)): string {
  // A JSON string is also a YAML string, whatever characters the title has.
  return `---\ntitle: ${JSON.stringify(title)}\n---\n\nWrite the page here.\n`
}

/** One place in `sidebar.yaml` that names a page. */
interface SidebarRef {
  /** The reference as the resolver reads it. */
  slug: string
  /** Where the scalar is in the source, quotes included. */
  start: number
  end: number
  /** The entry the reference belongs to, and the list that entry is in. */
  entry: Node
  list: { items: unknown[] }
}

/** Every page reference in a sidebar file: plain entries, and the `file:` of the long form. */
function sidebarRefs(source: string): SidebarRef[] | undefined {
  const doc = parseDocument(source)
  if (doc.errors.length > 0) return undefined
  const found: SidebarRef[] = []

  const walk = (list: unknown) => {
    if (!isSeq(list)) return
    for (const entry of list.items) {
      if (isScalar(entry) && typeof entry.value === 'string' && entry.range) {
        found.push({ slug: refToSlug(entry.value), start: entry.range[0], end: entry.range[1], entry, list })
      } else if (isMap(entry)) {
        const file = entry.get('file', true)
        if (isScalar(file) && typeof file.value === 'string' && file.range) {
          found.push({ slug: refToSlug(file.value), start: file.range[0], end: file.range[1], entry, list })
        }
        walk(entry.get('items', true))
      }
    }
  }
  walk(doc.contents)
  return found
}

const slugOf = (id: string) => refToSlug(id)

/** Does the sidebar file name this page? */
export function sidebarMentions(source: string, id: string): boolean {
  return (sidebarRefs(source) ?? []).some((ref) => ref.slug === slugOf(id))
}

/**
 * The sidebar file with every reference to one page pointing at another.
 * Only those references change: each is rewritten where it stands, in the
 * spelling it had (quoted or not, with the extension or without), and the
 * rest of the file is left byte for byte as it was written.
 */
export function renameInSidebar(source: string, from: string, to: string): string {
  const refs = (sidebarRefs(source) ?? []).filter((ref) => ref.slug === slugOf(from))
  let result = source
  // From the end, so that the positions before it stay true.
  for (const ref of refs.sort((a, b) => b.start - a.start)) {
    const written = result.slice(ref.start, ref.end)
    const quote = written[0] === '"' || written[0] === "'" ? written[0] : ''
    const inner = quote ? written.slice(1, -1) : written
    const lead = /^\.?\/+/.exec(inner)?.[0] ?? ''
    const withExtension = /\.mdx?$/i.test(inner)
    const target = withExtension ? to : to.replace(/\.mdx?$/i, '').replace(/(^|\/)index$/i, '') || 'index'
    result = `${result.slice(0, ref.start)}${quote}${lead}${target}${quote}${result.slice(ref.end)}`
  }
  return result
}

/**
 * The sidebar file without its entries for one page. An entry is taken out
 * only where that is plainly safe: it has lines to itself in a block list,
 * and it is not the last entry of that list, which would leave a group with
 * nothing in it. Returns the file unchanged where it is not.
 */
export function removeFromSidebar(source: string, id: string): string {
  const refs = (sidebarRefs(source) ?? []).filter((ref) => ref.slug === slugOf(id))
  let result = source
  for (const ref of refs.sort((a, b) => b.start - a.start)) {
    const range = ref.entry.range
    if (!range || ref.list.items.length < 2) continue
    const lineStart = result.lastIndexOf('\n', range[0] - 1) + 1
    // A block list entry: nothing before it on its line but the dash.
    if (!/^[ \t]*-[ \t]+$/.test(result.slice(lineStart, range[0]))) continue
    // An entry of several lines ends after its last line break. A one-line entry ends before it, and
    // may have a comment after it on that line.
    let lineEnd = range[1]
    if (result[lineEnd - 1] !== '\n') {
      const newline = result.indexOf('\n', lineEnd)
      lineEnd = newline === -1 ? result.length : newline + 1
      if (!/^[ \t]*(#.*)?\r?\n?$/.test(result.slice(range[1], lineEnd))) continue
    }
    result = result.slice(0, lineStart) + result.slice(lineEnd)
  }
  return result
}
