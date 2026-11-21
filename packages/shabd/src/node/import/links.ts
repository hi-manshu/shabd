/**
 * Links and images.
 *
 * Shabd reads a link the way GitHub does: as the path of a file, from the
 * folder the page is in. Most links in the four source tools already work
 * that way and are left alone. A link is rewritten only when the page it
 * leads to in the source is known and Shabd would read it as some other
 * address: a page that was renamed on the way in, a link written as an
 * address with the site's base in front, Starlight's links from a page's
 * address instead of its folder.
 *
 * Images named by a relative path are bundled, and a build stops at one that
 * is missing, so each is looked for. One that lives outside the content
 * folder is pointed at the copy the import makes of it: by a relative path,
 * or from the root of the site when the copy is in public/.
 */
import path from 'node:path'
import { fileToSlug, isExternal, slugToPath } from '../../shared/paths.js'
import { resolvePageLink } from '../markdown/plugins/rehype-links.js'
import { mapProse, type Line } from './text.js'
import type { LinkRules, Note, SourcePage } from './types.js'

const { posix } = path

export interface LinkContext {
  rules: LinkRules
  page: SourcePage
  /** Source file → the id of the page in the new site. */
  byFile: ReadonlyMap<string, string>
  /** The address the source gives a page → the id of the page in the new site. */
  byRoute: ReadonlyMap<string, string>
  /**
   * Where the file an image names will be in the new site, from the site
   * folder: `content/guide/a.png`. `file` is a path from the source's content
   * folder and may lead out of it. Undefined when there is no such file.
   * Without this, images are not looked at.
   */
  placed?: ((file: string) => string | undefined) | undefined
}

const PAGE_FILE = /\.mdx?$/i
const LINK = /(!?)\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*(<[^<>]+>|[^()\s]+(?:\([^()\s]*\)[^()\s]*)*)(\s+(?:"[^"]*"|'[^']*'))?\s*\)/g
const DEFINITION = /^(\s{0,3}\[[^\]^][^\]]*\]:\s*)(\S+)(.*)$/

const relativeTo = (folder: string, target: string) => {
  const relative = posix.relative(folder, target)
  return relative.startsWith('.') ? relative : `./${relative}`
}

/** The id of the page a link leads to in the source, if that can be told. */
function targetPage(target: string, { rules, page, byFile, byRoute }: LinkContext): string | undefined {
  let rest = target
  if (target.startsWith('/')) {
    for (const prefix of rules.prefixes) {
      if (prefix && (rest === prefix || rest.startsWith(`${prefix}/`))) rest = rest.slice(prefix.length)
    }
    rest = rest.replace(/^\/+/, '')
  }

  if (PAGE_FILE.test(target)) {
    return byFile.get(target.startsWith('/') ? rest : posix.join(posix.dirname(page.source), target))
  }
  const extension = /\.([a-z0-9]{1,8})$/i.exec(target)?.[1]?.toLowerCase()
  if (extension !== undefined && extension !== 'html') return undefined

  // A link to an address. From a file's folder, or in Starlight from the page's own address.
  const from = rules.relative === 'address' ? page.route : posix.dirname(page.id)
  const route = target.startsWith('/') ? rest : posix.join(from, target)
  if (route.startsWith('..')) return undefined
  return byRoute.get(
    route
      .replace(/\/+$/, '')
      .replace(/\.html$/i, '')
      .replace(/(^|\/)index$/, '')
      .replace(/^\.$/, ''),
  )
}

export function rewriteLinks(lines: Line[], context: LinkContext, notes: Note[]): Line[] {
  const folder = posix.dirname(context.page.id)

  const rewrite = (href: string, image: boolean, line: Line): string => {
    const bare = href.startsWith('<') ? href.slice(1, -1) : href
    if (!bare || isExternal(bare) || /^[#?]/.test(bare) || /[{}]/.test(bare)) return href
    const cut = bare.search(/[?#]/)
    let target = cut === -1 ? bare : bare.slice(0, cut)
    const rest = cut === -1 ? '' : bare.slice(cut)
    try {
      target = decodeURI(target)
    } catch {
      // Not an encoded path: use it as written.
    }

    if (image) {
      if (!context.placed || target.startsWith('/')) return href
      const placed = context.placed(posix.join(posix.dirname(context.page.source), target))
      if (placed === undefined) {
        notes.push({ kind: 'manual', message: `The image ${bare} is not in the source. A build stops at an image that is missing.`, line: line.number })
        return href
      }
      // A file in public/ is served from the root of the site, and is named from there.
      const written = placed.startsWith('public/') ? placed.slice('public'.length) : relativeTo(posix.join('content', folder), placed)
      if (written === relativeTo('.', posix.normalize(target))) return href
      notes.push({ kind: 'converted', what: 'link', line: line.number })
      return encodeURI(written) + rest
    }

    const page = targetPage(target, context)
    if (page === undefined) {
      // Shabd bundles images, and serves other files only from `public/`.
      if (!target.startsWith('/') && /\.(?!mdx?$|html?$)[a-z0-9]{1,8}$/i.test(target)) {
        notes.push({
          kind: 'manual',
          message: `A link to a file (${bare}). Shabd serves files from public/ only: move it there and link to it from the root, as /name.`,
          line: line.number,
        })
      }
      return href
    }
    // Leave a link that Shabd already reads as the same page.
    if (resolvePageLink(target, context.page.id) === slugToPath(fileToSlug(page))) return href
    notes.push({ kind: 'converted', what: 'link', line: line.number })
    return encodeURI(relativeTo(folder, page)) + rest
  }

  const inline = (prose: string, line: Line): string =>
    prose.replace(LINK, (_whole, bang: string, text: string, href: string, title: string = '') => {
      // The text of a link may hold an image with a path of its own.
      return `${bang}[${inline(text, line)}](${rewrite(href, bang === '!', line)}${title})`
    })

  return lines.map((line) => {
    if (line.code) return line
    const definition = DEFINITION.exec(line.text)
    const text = definition
      ? `${definition[1]!}${rewrite(definition[2]!, false, line)}${definition[3]!}`
      : mapProse(line.text, (prose) => inline(prose, line))
    return text === line.text ? line : { ...line, text }
  })
}
