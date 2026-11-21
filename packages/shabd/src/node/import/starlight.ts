/**
 * Astro Starlight.
 *
 * The closest of the four to Shabd: its sidebar config maps onto
 * sidebar.yaml almost entry for entry, and its components have the names
 * Shabd's have. What differs:
 *
 *   - The options are an argument of `starlight({ … })` in astro.config, so
 *     the config is run with a stand-in for the package that keeps them.
 *   - Links are written as addresses and read from the page's own address,
 *     which ends in a slash. `links.ts` points them at files.
 *   - Components are imported in each .mdx page. Shabd's need no import.
 *
 * `<Steps>` and `<FileTree>` are kept as they are: Shabd has components of
 * those names that read the same lists.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { BadgeInput } from '../../shared/schema.js'
import { BADGE_VARIANTS } from '../../shared/badge.js'
import { asString, evaluateConfig, isRecord, provide, reason } from './evaluate.js'
import { asNumber, convertPage } from './frontmatter.js'
import { firstExisting, isPage, isUrl, listFiles, pathFrom, routeOf, socialName, splitUrl } from './site.js'
import {
  attr,
  attribute,
  containerAlert,
  convertContainers,
  filterImports,
  rewriteTags,
  spaceBlocks,
  stringValue,
  type Alert,
  type Tag,
} from './text.js'
import { MESSAGES, type Conversion, type FileNote, type NavItem, type Relink, type SiteInput, type SourcePage, type SourceSite } from './types.js'

const { posix } = path

/* ──────────────────────────────── pages ─────────────────────────────── */

/** Starlight's yellow aside is `caution` and its red one `danger`. Shabd's are `WARNING` and `CAUTION`. */
const ALERTS: Record<string, Alert> = { note: 'NOTE', tip: 'TIP', caution: 'WARNING', danger: 'CAUTION' }
const PLAIN = new Set(Object.keys(ALERTS))
const CALLOUT_TYPES: Record<string, string> = { note: 'note', tip: 'tip', caution: 'warning', danger: 'caution' }

const COMPONENTS = '@astrojs/starlight/components'
/** Components Shabd has under the same name, wrapped around the same kind of list. */
const SAME = new Set(['Steps', 'FileTree'])

/** An attribute as it was written, when it is one of `names` and has a value. */
const kept = (tag: Tag, names: string[]) =>
  tag.attrs.filter(([name, value]) => names.includes(name) && value !== undefined).map(([name, value]) => ` ${name}=${value}`).join('')

function badge(value: unknown): BadgeInput | undefined {
  if (typeof value === 'string' && value) return value
  if (!isRecord(value) || !asString(value.text)) return undefined
  const variant = BADGE_VARIANTS.find((name) => name === value.variant)
  return variant ? { text: value.text as string, variant } : (value.text as string)
}

export interface StarlightPageOptions {
  links?: Relink | undefined
  /**
   * Where the picture of a hero will be served from in the new site, given
   * the path the page names it by. Undefined when there is no such file.
   */
  heroImage?: ((file: string) => string | undefined) | undefined
}

export function convertStarlightPage(source: string, format: 'md' | 'mdx', options: StarlightPageOptions = {}): Conversion {
  return convertPage(source, {
    frontmatter(frontmatter) {
      const template = frontmatter.get('template')
      if (template === 'splash' || template === 'doc') {
        frontmatter.delete('template')
        if (template === 'splash') frontmatter.set('layout', 'splash')
        frontmatter.converted++
      }

      const hero = frontmatter.get('hero')
      if (isRecord(hero)) {
        const actions = (Array.isArray(hero.actions) ? hero.actions : []).filter(isRecord).flatMap((action) => {
          const label = asString(action.text)
          const link = asString(action.link)
          return label && link ? [{ label, link, ...(action.variant === 'secondary' || action.variant === 'minimal' ? { variant: 'secondary' } : {}) }] : []
        })
        // The picture is a file beside the pages, which Astro bundles. Shabd's hero takes one from public/.
        const file = isRecord(hero.image) ? asString(hero.image.file ?? hero.image.light) : undefined
        const image = file ? options.heroImage?.(file) : undefined
        if (isRecord(hero.image) && !image) frontmatter.manual.push({ key: 'hero', message: 'The picture of the hero was not carried over. Put it in public/ and name it under `hero.image`.' })
        frontmatter.set('hero', {
          ...(asString(hero.title) ? { title: hero.title } : {}),
          ...(asString(hero.tagline) ? { tagline: hero.tagline } : {}),
          ...(image ? { image } : {}),
          ...(actions.length ? { actions } : {}),
        })
        frontmatter.converted++
      }

      const toc = frontmatter.get('tableOfContents')
      if (toc !== undefined) {
        const minDepth = isRecord(toc) ? asNumber(toc.minHeadingLevel) : undefined
        const maxDepth = isRecord(toc) ? asNumber(toc.maxHeadingLevel) : undefined
        frontmatter.delete('tableOfContents')
        if (toc === false) frontmatter.set('toc', false)
        else if (minDepth !== undefined || maxDepth !== undefined) frontmatter.set('toc', { ...(minDepth !== undefined ? { minDepth } : {}), ...(maxDepth !== undefined ? { maxDepth } : {}) })
        frontmatter.converted++
      }

      const sidebar = frontmatter.get('sidebar')
      if (isRecord(sidebar)) {
        // The same key in both, with two names changed: `hidden` is `exclude`, and there are no `attrs`.
        const label = asString(sidebar.label)
        const order = asNumber(sidebar.order)
        const mark = badge(sidebar.badge)
        frontmatter.set('sidebar', {
          ...(label ? { label } : {}),
          ...(order !== undefined ? { order } : {}),
          ...(mark !== undefined ? { badge: mark } : {}),
          ...(sidebar.hidden === true ? { exclude: true } : {}),
        })
        if (sidebar.hidden !== undefined || sidebar.attrs !== undefined) frontmatter.converted++
      }

      if (frontmatter.get('editUrl') === false) {
        frontmatter.delete('editUrl')
        frontmatter.set('editLink', false)
        frontmatter.converted++
      }
      // Starlight hides one link at a time. Shabd shows both or neither.
      if (frontmatter.get('prev') === false && frontmatter.get('next') === false) {
        frontmatter.delete('prev')
        frontmatter.delete('next')
        frontmatter.set('pagination', false)
        frontmatter.converted++
      }
      const slug = asString(frontmatter.get('slug'))
      if (slug) frontmatter.manual.push({ key: 'slug', message: MESSAGES.slug(slug) })
    },
    body(lines, notes) {
      let out = options.links ? options.links(lines, notes) : lines
      if (format === 'mdx') {
        out = filterImports(out, ({ from, line }) => {
          if (from === COMPONENTS) return false
          notes.push({ kind: 'manual', message: MESSAGES.imported(from), line: line.number })
          return true
        })
        out = rewriteTags(out, (tag, line) => {
          const converted = (what: 'tab group' | 'callout' | 'component') => notes.push({ kind: 'converted', what, line: line.number })
          switch (tag.name) {
            case 'Tabs':
              if (!tag.closing) converted('tab group')
              return tag.closing ? '</Tabs>' : '<Tabs>'
            case 'TabItem':
              return tag.closing ? '</Tab>' : `<Tab${kept(tag, ['label'])}>`
            case 'Card':
              return tag.closing ? undefined : `<Card${kept(tag, ['title'])}>`
            case 'CardGrid':
              return tag.closing ? undefined : '<CardGrid>'
            case 'LinkCard': {
              // A card that is a link, with its text in an attribute. Shabd's card takes the text as its content.
              const description = stringValue(attr(tag, 'description'))
              converted('component')
              return `<Card${kept(tag, ['title', 'href'])}>${description ?? ''}</Card>`
            }
            case 'Badge':
              return tag.closing ? undefined : `<Badge${kept(tag, ['text', 'variant'])}${tag.selfClosing ? ' />' : '>'}`
            case 'Aside': {
              if (tag.closing) return '</Callout>'
              const title = stringValue(attr(tag, 'title'))
              converted('callout')
              return `<Callout type="${CALLOUT_TYPES[stringValue(attr(tag, 'type')) ?? 'note'] ?? 'note'}"${title ? ` title="${attribute(title)}"` : ''}>`
            }
            default:
              if (!/^[A-Z]/.test(tag.name) || tag.closing || SAME.has(tag.name)) return undefined
              notes.push({ kind: 'manual', message: MESSAGES.component(tag.name), line: line.number })
              return undefined
          }
        })
      }
      out = convertContainers(out, (container) => containerAlert(container, ALERTS, PLAIN, notes))
      return { lines: spaceBlocks(out), mdx: format === 'mdx' }
    },
  })
}

/* ───────────────────────────── navigation ───────────────────────────── */

/** A page's address as Starlight writes it in a sidebar: lower case, no slashes at the ends. */
const slugOf = (value: string) => value.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').replace(/(^|\/)index$/, '').toLowerCase()

/**
 * Starlight's `sidebar`, entry for entry: a page by its slug, a link, a
 * group with `items`, or a group to `autogenerate` from a folder. `pages`
 * maps a page's address to its id in the new site.
 */
export function starlightSidebar(sidebar: unknown, pages: ReadonlyMap<string, string>, problems: string[]): NavItem[] {
  const page = (slug: string, label: string | undefined, mark: unknown): NavItem[] => {
    const id = pages.get(slugOf(slug))
    if (id !== undefined) return [{ type: 'page', id, label, badge: badge(mark) }]
    problems.push(`The sidebar names the page "${slug}", which was not found. It was left out.`)
    return []
  }
  return (Array.isArray(sidebar) ? sidebar : []).flatMap((entry): NavItem[] => {
    if (typeof entry === 'string') return page(entry, undefined, undefined)
    if (!isRecord(entry)) return []
    const label = asString(entry.label)
    if (typeof entry.slug === 'string') return page(entry.slug, label, entry.badge)
    if (typeof entry.link === 'string') {
      // A link to a page of the site is that page, under the label the link gives it.
      const id = isUrl(entry.link) ? undefined : pages.get(slugOf(entry.link))
      return id !== undefined ? [{ type: 'page', id, label, badge: badge(entry.badge) }] : [{ type: 'link', href: entry.link, label: label ?? entry.link, badge: badge(entry.badge) }]
    }
    const collapsed = entry.collapsed === true || undefined
    if (isRecord(entry.autogenerate) && typeof entry.autogenerate.directory === 'string') {
      return [{ type: 'generated', label: label ?? entry.autogenerate.directory, directory: entry.autogenerate.directory.replace(/^\/+|\/+$/g, ''), collapsed }]
    }
    if (Array.isArray(entry.items)) {
      return [{ type: 'group', label: label ?? '', collapsed, badge: badge(entry.badge), items: starlightSidebar(entry.items, pages, problems) }]
    }
    return []
  })
}

/* ──────────────────────────────── site ──────────────────────────────── */

export const ASTRO_CONFIG_FILES = ['mjs', 'ts', 'js', 'mts', 'cjs'].map((extension) => `astro.config.${extension}`)

/** The text of a setting that may be one string or one per language. */
const localised = (value: unknown): string | undefined => asString(value) ?? (isRecord(value) ? asString(value.en ?? Object.values(value)[0]) : undefined)

export async function readStarlight(root: string): Promise<SourceSite> {
  const notes: FileNote[] = []
  const configFile = firstExisting(root, ASTRO_CONFIG_FILES)
  const configName = configFile ? path.basename(configFile) : 'astro.config.mjs'
  let astro: Record<string, unknown> = {}
  let options: Record<string, unknown> | undefined
  let failed: string | undefined
  if (configFile) {
    try {
      const identity = (value: unknown) => value
      const evaluated = await evaluateConfig(configFile, {
        'astro/config': provide('astro/config', { defineConfig: identity }),
        // The real package returns an integration that no longer shows what it was given.
        '@astrojs/starlight': provide('@astrojs/starlight', { default: (given: unknown) => ({ name: '@astrojs/starlight', options: given }) }),
      })
      if (isRecord(evaluated.config)) astro = evaluated.config
      const integrations = Array.isArray(astro.integrations) ? astro.integrations.flat() : []
      const found = integrations.find((integration) => isRecord(integration) && integration.name === '@astrojs/starlight')
      if (isRecord(found) && isRecord(found.options)) options = found.options
      else failed = 'no `starlight({ … })` was found among its integrations'
    } catch (error) {
      failed = reason(error)
    }
    if (failed) notes.push({ file: configName, message: `The config could not be read (${failed}), so the title, the links and the sidebar were not taken from it.` })
  }
  const settings = options ?? {}

  const contentDir = path.join(root, 'src', 'content', 'docs')
  const files = await listFiles(contentDir)
  const pages: SourcePage[] = files.filter(isPage).map((source) => ({ source, id: source, route: routeOf(source).toLowerCase() }))
  const byRoute = new Map(pages.map((page) => [page.route, page.id]))
  if (files.some((file) => /\.(mdoc|markdoc)$/.test(file))) notes.push({ file: pathFrom(root, contentDir), message: 'Markdoc pages were not imported: Shabd reads .md and .mdx.' })

  const site: SiteInput = {
    title: localised(settings.title) ?? path.basename(path.resolve(root)),
    description: localised(settings.description),
    ...splitUrl(astro.site, astro.base),
    favicon: asString(settings.favicon),
  }
  const edit = isRecord(settings.editLink) ? asString(settings.editLink.baseUrl) : undefined
  site.repo = /^https:\/\/github\.com\/[^/]+\/[^/]+/.exec(edit ?? '')?.[0]

  // `social` is a list of `{ icon, href }`, and was a map of name to address before Starlight 0.33.
  const social: Record<string, string> = {}
  const listed = Array.isArray(settings.social) ? settings.social.filter(isRecord).map((link) => [asString(link.icon) ?? 'link', link.href] as const) : isRecord(settings.social) ? Object.entries(settings.social) : []
  for (const [name, href] of listed) {
    if (!isUrl(href)) continue
    social[socialName(name)] = href
    if (socialName(name) === 'github') site.repo ??= /^https:\/\/github\.com\/[^/]+\/[^/]+/.exec(href)?.[0]
  }
  site.social = social

  // The logo is a file in the project, which Astro bundles. Shabd looks for it in public/.
  const publicFiles: { from: string; to: string }[] = []
  const toPublic = (file: string, from: string): string | undefined => {
    const absolute = path.resolve(from, file)
    if (!existsSync(absolute)) return undefined
    const to = path.basename(absolute)
    if (!publicFiles.some((entry) => entry.to === to)) publicFiles.push({ from: absolute, to })
    return `/${to}`
  }
  const logo = isRecord(settings.logo) ? settings.logo : {}
  const light = asString(logo.src ?? logo.light)
  const dark = asString(logo.dark)
  const lightPath = light ? toPublic(light, root) : undefined
  const darkPath = dark ? toPublic(dark, root) : undefined
  if (lightPath) site.logo = darkPath && darkPath !== lightPath ? { light: lightPath, dark: darkPath } : lightPath

  let nav: NavItem[] | undefined
  let navSource = failed
    ? `${configName} could not be read, so there are no entries: Shabd generates the sidebar from the folders.`
    : 'The config has no sidebar, so there are no entries: Shabd generates the sidebar from the folders, as Starlight did.'
  if (Array.isArray(settings.sidebar)) {
    const problems: string[] = []
    nav = starlightSidebar(settings.sidebar, byRoute, problems)
    navSource = `From \`sidebar\` in ${configName}.`
    for (const message of problems) notes.push({ file: configName, message })
  }
  if (isRecord(settings.locales) && Object.keys(settings.locales).length > 1) {
    notes.push({ file: configName, message: 'The site has translations. Every page is imported, each language under its own folder, and nothing links them.' })
  }

  return {
    tool: 'starlight',
    contentDir,
    pages,
    publicDirs: [path.join(root, 'public')],
    publicFiles,
    site,
    nav,
    navSource,
    links: { relative: 'address', prefixes: [site.base?.replace(/\/$/, '') ?? ''].filter(Boolean) },
    notes,
    convert: (text, page, links) =>
      convertStarlightPage(text, /\.mdx$/i.test(page.source) ? 'mdx' : 'md', {
        links,
        heroImage: (file) => toPublic(file, path.join(contentDir, posix.dirname(page.source))),
      }),
  }
}
