/**
 * VitePress.
 *
 * Its pages are Markdown that may hold HTML and Vue. Most of the Markdown
 * reads the same in Shabd. What does not: containers (`::: tip`), groups of
 * code blocks shown as tabs (`::: code-group`), and the options of a code
 * fence, which VitePress writes against the language (`js{4}`,
 * `ts:line-numbers`).
 *
 * A page with a code group becomes MDX, because tabs are a component. The
 * rest of that page then has to read as MDX too, which `makeMdxSafe` sees
 * to as far as it can. Vue itself is not converted: `<script setup>`,
 * `{{ expressions }}` and Vue components are reported.
 */
import path from 'node:path'
import { asString, evaluateConfig, isRecord, provide, reason } from './evaluate.js'
import { asNumber, convertPage } from './frontmatter.js'
import { firstExisting, isPage, isUrl, listFiles, pathFrom, routeOf, socialName, splitUrl } from './site.js'
import {
  attr,
  attribute,
  containerAlert,
  convertContainers,
  dropHeadingIds,
  makeMdxSafe,
  mapFences,
  markCode,
  rewriteTags,
  spaceBlocks,
  stringValue,
  tabs,
  type Alert,
  type Line,
} from './text.js'
import { MESSAGES, type Conversion, type FileNote, type NavItem, type Relink, type SiteInput, type SourcePage, type SourceSite } from './types.js'

/* ──────────────────────────────── pages ─────────────────────────────── */

const ALERTS: Record<string, Alert> = {
  info: 'NOTE',
  note: 'NOTE',
  details: 'NOTE',
  tip: 'TIP',
  important: 'IMPORTANT',
  warning: 'WARNING',
  danger: 'CAUTION',
  caution: 'CAUTION',
}
const PLAIN = new Set(['info', 'note', 'tip', 'important', 'warning', 'danger', 'caution'])
const BADGES: Record<string, string> = { info: 'note', tip: 'tip', warning: 'caution', danger: 'danger' }

/**
 * The options of a code fence: `js{4}` → `js {4}`, `ts:line-numbers` →
 * `ts showLineNumbers`, `js [config.js]` → `js title="config.js"`.
 * Undefined for a fence that already reads the same in Shabd.
 */
export function vitepressFence(info: string): string | undefined {
  const language = /^[^\s{:[]*/.exec(info)![0]
  let rest = info.slice(language.length)
  const options: string[] = []
  rest = rest.replace(/:(no-)?line-numbers(?:=\d+)?/, (_flag, no?: string) => {
    options.push(no ? 'noLineNumbers' : 'showLineNumbers')
    return ' '
  })
  rest = rest.replace(/\[([^\]]+)\]/, (_label, title: string) => {
    options.unshift(`title="${title.replace(/"/g, "'")}"`)
    return ' '
  })
  const written = [language, ...options, rest.trim()].filter(Boolean).join(' ').replace(/\s+/g, ' ')
  return written === info ? undefined : written
}

export function convertVitepressPage(source: string, options: { links?: Relink | undefined } = {}): Conversion {
  /** `features:` of a home page. They are drawn as cards under the hero. */
  let features: Record<string, unknown>[] = []
  return convertPage(source, {
    frontmatter(frontmatter) {
      const layout = frontmatter.get('layout')
      if (layout === 'home' || layout === 'page') {
        frontmatter.set('layout', 'splash')
        frontmatter.converted++
      }
      const hero = frontmatter.get('hero')
      if (isRecord(hero)) {
        const image = isRecord(hero.image) ? (hero.image.src ?? hero.image.light) : hero.image
        const actions = (Array.isArray(hero.actions) ? hero.actions : []).filter(isRecord).flatMap((action) => {
          const label = asString(action.text)
          const link = asString(action.link)
          return label && link ? [{ label, link, ...(action.theme === 'alt' ? { variant: 'secondary' } : {}) }] : []
        })
        // VitePress has a name and a line of text above the tagline. The text is the headline; the name is the site's.
        const title = asString(hero.text) ?? asString(hero.name)
        frontmatter.set('hero', {
          ...(title ? { title } : {}),
          ...(asString(hero.tagline) ? { tagline: hero.tagline } : {}),
          ...(asString(image) ? { image } : {}),
          ...(actions.length ? { actions } : {}),
        })
        frontmatter.converted++
      }
      if (Array.isArray(frontmatter.get('features'))) {
        features = (frontmatter.take('features') as unknown[]).filter(isRecord)
        frontmatter.converted++
      }

      const outline = frontmatter.get('outline')
      const levels = Array.isArray(outline) ? outline.map(asNumber) : outline === 'deep' ? [2, 6] : [asNumber(outline), asNumber(outline)]
      if (outline === false || frontmatter.get('aside') === false) {
        frontmatter.delete('outline')
        frontmatter.delete('aside')
        frontmatter.set('toc', false)
        frontmatter.converted++
      } else if (levels[0] !== undefined && levels[1] !== undefined) {
        frontmatter.delete('outline')
        frontmatter.set('toc', { minDepth: levels[0], maxDepth: levels[1] })
        frontmatter.converted++
      }
      // VitePress hides one link at a time. Shabd shows both or neither.
      if (frontmatter.get('prev') === false && frontmatter.get('next') === false) {
        frontmatter.delete('prev')
        frontmatter.delete('next')
        frontmatter.set('pagination', false)
        frontmatter.converted++
      }
    },
    body(lines, notes) {
      const isGroup = (line: Line) => !line.code && /^\s*:{3,}\s*code-group\b/.test(line.text)
      const mdx = features.length > 0 || lines.some(isGroup)
      let out = options.links ? options.links(lines, notes) : lines

      // A Vue page keeps its script and its styles in blocks of their own. Shabd renders the HTML of a
      // page, so a block left in would reach the browser as a script it cannot run. They are left out.
      let vueBlock: string | undefined
      out = out.filter((line) => {
        if (line.code) return true
        if (vueBlock === undefined) {
          const opening = /^<(script|style)[\s>]/.exec(line.text)?.[1]
          if (opening === undefined) return true
          notes.push({ kind: 'manual', message: 'A `<script>` or `<style>` block was left out: Vue code does not run in Shabd.', line: line.number })
          vueBlock = opening
        }
        if (line.text.includes(`</${vueBlock}>`)) vueBlock = undefined
        return false
      })

      for (const line of out) {
        if (line.code) continue
        if (/\{\{.*\}\}/.test(line.text)) notes.push({ kind: 'manual', message: 'A Vue expression (`{{ … }}`) is written out as it is: Shabd does not evaluate it.', line: line.number })
        else if (/^<<<\s|<!--\s*@include:/.test(line.text)) notes.push({ kind: 'manual', message: 'A file included from elsewhere is not included by Shabd. Paste the text in.', line: line.number })
      }
      out = dropHeadingIds(out, notes)

      if (mdx) {
        const safe = makeMdxSafe(out)
        for (let count = 0; count < safe.comments; count++) notes.push({ kind: 'converted', what: 'comment' })
        out = rewriteTags(safe.lines, (tag, line) => {
          if (tag.name === 'Badge' && !tag.closing) {
            const text = stringValue(attr(tag, 'text'))
            const variant = BADGES[stringValue(attr(tag, 'type')) ?? '']
            notes.push({ kind: 'converted', what: 'component', line: line.number })
            return `<Badge${text !== undefined ? ` text="${attribute(text)}"` : ''}${variant ? ` variant="${variant}"` : ''}${tag.selfClosing ? ' />' : '>'}`
          }
          if (/^[A-Z]/.test(tag.name) && tag.name !== 'Badge' && !tag.closing) notes.push({ kind: 'manual', message: MESSAGES.component(tag.name), line: line.number })
          return undefined
        })
      }

      out = convertContainers(markCode(out), (container) => {
        const name = container.name.toLowerCase()
        if (name === 'code-group') {
          // Each code block of the group is a tab, labelled by the name in brackets after its language.
          const items: { label: string; body: Line[] }[] = []
          for (const line of container.body) {
            if (line.fence === 'open') {
              const info = line.text.replace(/^[\s>]*(`{3,}|~{3,})/, '').trim()
              const label = /\[([^\]]+)\]/.exec(info)?.[1] ?? (/^[^\s{:[]+/.exec(info)?.[0] || `Tab ${items.length + 1}`)
              items.push({ label, body: [{ ...line, text: line.text.replace(/\s*\[[^\]]+\]/, '') }] })
            } else if (line.code) {
              items.at(-1)?.body.push(line)
            }
          }
          if (items.length === 0) return undefined
          notes.push({ kind: 'converted', what: 'tab group', line: container.open.number })
          return tabs(items, container.open, container.indent)
        }
        // `raw` and `v-pre` only keep VitePress from touching what is inside.
        if (name === 'raw' || name === 'v-pre') return container.body
        const converted = containerAlert(container, ALERTS, PLAIN, notes)
        if (converted && name === 'details') notes.push({ kind: 'manual', message: MESSAGES.collapsible, line: container.open.number })
        return converted
      })

      out = mapFences(markCode(out), (info, line) => {
        const changed = vitepressFence(info)
        if (changed !== undefined) notes.push({ kind: 'converted', what: 'code fence', line: line.number })
        return changed
      })

      if (features.length > 0) {
        // Numbered as the line they are put before, so that notes further down still find their place.
        const at = out[0]?.number ?? 1
        const text = (value: string): Line => ({ text: value, number: at, code: false })
        const cards = features.flatMap((feature) => {
          const title = asString(feature.title) ?? ''
          const link = asString(feature.link)
          return [text(`<Card title="${attribute(title)}"${link ? ` href="${attribute(link)}"` : ''}>`), text(''), text(asString(feature.details) ?? ''), text(''), text('</Card>')]
        })
        // Under the hero, which is where VitePress draws them. A heading that opens the page is its title, and stays first.
        const first = out.findIndex((line) => line.text.trim() !== '')
        const start = first !== -1 && /^#\s/.test(out[first]!.text) ? first + 1 : Math.max(first, 0)
        // An empty line after the frontmatter, when the cards are the first thing on the page.
        out = [...(start === 0 ? [text('')] : out.slice(0, start)), { ...text('<CardGrid>'), edge: 'start' }, ...cards, { ...text('</CardGrid>'), edge: 'end' }, ...out.slice(start)]
        notes.push({ kind: 'converted', what: 'component' })
      }
      return { lines: spaceBlocks(out), mdx }
    },
  })
}

/* ───────────────────────────── navigation ───────────────────────────── */

/** The page a VitePress link names: `/guide/intro`, `/guide/intro.md`, `/guide/`. */
const routeOfLink = (link: string) =>
  link
    .replace(/[?#].*$/, '')
    .replace(/\.(md|html)$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/(^|\/)index$/, '')

/**
 * `themeConfig.sidebar`: a list of groups, or several lists keyed by the
 * part of the site each is shown on. `pages` maps a page's address
 * (`guide/intro`) to its id in the new site.
 */
export function vitepressSidebar(sidebar: unknown, pages: ReadonlyMap<string, string>, problems: string[]): NavItem[] {
  const read = (items: unknown, base: string): NavItem[] =>
    (Array.isArray(items) ? items : []).filter(isRecord).flatMap((item): NavItem[] => {
      const label = asString(item.text)
      const below = base + (asString(item.base) ?? '')
      const link = asString(item.link)
      let own: NavItem[] = []
      if (link && isUrl(link)) {
        own = [{ type: 'link', href: link, label: label ?? link }]
      } else if (link) {
        const id = pages.get(routeOfLink(below + link))
        if (id !== undefined) own = [{ type: 'page', id, label }]
        else problems.push(`The sidebar links to ${below + link}, which is not a page. The entry was left out.`)
      }
      if (!Array.isArray(item.items)) return own
      return [{ type: 'group', label: label ?? '', collapsed: item.collapsed === true || undefined, items: [...own, ...read(item.items, below)] }]
    })

  if (Array.isArray(sidebar)) return read(sidebar, '')
  if (!isRecord(sidebar)) return []
  const parts = Object.keys(sidebar)
  if (parts.length > 1) problems.push(`The site has a sidebar for each of ${parts.join(', ')}. Shabd has one, so they follow each other in that order.`)
  return Object.values(sidebar).flatMap((part) => (isRecord(part) ? read(part.items, asString(part.base) ?? '') : read(part, '')))
}

/* ──────────────────────────────── site ──────────────────────────────── */

const CONFIG_FILES = ['ts', 'mts', 'js', 'mjs', 'cjs'].map((extension) => path.join('.vitepress', `config.${extension}`))

/** The folder that holds `.vitepress`: the one given, or `docs` inside it, which is where most projects keep it. */
export function vitepressRoot(root: string): string | undefined {
  return [root, path.join(root, 'docs')].find((dir) => firstExisting(dir, CONFIG_FILES) !== undefined)
}

export async function readVitepress(given: string): Promise<SourceSite> {
  const root = vitepressRoot(given) ?? given
  const notes: FileNote[] = []
  const configFile = firstExisting(root, CONFIG_FILES)
  const configName = configFile ? pathFrom(given, configFile) : '.vitepress/config.js'
  let config: Record<string, unknown> = {}
  let failed: string | undefined
  if (configFile) {
    try {
      const identity = (value: unknown) => value
      const evaluated = await evaluateConfig(configFile, { vitepress: provide('vitepress', { defineConfig: identity, defineConfigWithTheme: identity }) })
      if (isRecord(evaluated.config)) config = evaluated.config
      else failed = 'it does not export a config'
    } catch (error) {
      failed = reason(error)
    }
    if (failed) notes.push({ file: configName, message: `The config could not be run (${failed}), so the title, the header links and the sidebar were not read from it.` })
  }

  const contentDir = path.resolve(root, asString(config.srcDir) ?? '.')
  const files = await listFiles(contentDir)
  const pages: SourcePage[] = files.filter((file) => isPage(file) && !file.startsWith('public/')).map((source) => ({ source, id: source, route: routeOf(source) }))
  const byRoute = new Map(pages.map((page) => [page.route, page.id]))

  const theme = isRecord(config.themeConfig) ? config.themeConfig : {}
  const sitemap = isRecord(config.sitemap) ? config.sitemap.hostname : undefined
  const logo = isRecord(theme.logo) ? (theme.logo.src ?? theme.logo.light) : theme.logo
  const footer = isRecord(theme.footer) ? (asString(theme.footer.copyright) ?? asString(theme.footer.message)) : undefined
  const site: SiteInput = {
    title: asString(config.title) ?? asString(theme.siteTitle) ?? path.basename(path.resolve(given)),
    description: asString(config.description),
    ...splitUrl(sitemap, config.base),
    lang: asString(config.lang),
    logo: asString(logo),
    footer: footer && !/[<{]/.test(footer) ? footer : undefined,
  }

  const social: Record<string, string> = {}
  for (const link of Array.isArray(theme.socialLinks) ? theme.socialLinks : []) {
    if (!isRecord(link) || !isUrl(link.link)) continue
    const name = socialName(asString(link.icon) ?? 'link')
    social[name] = link.link
    if (name === 'github') site.repo = /^https:\/\/github\.com\/[^/]+\/[^/]+/.exec(link.link)?.[0]
  }
  site.social = social

  // Header links. A menu of links has no counterpart, so its first link stands for it.
  const links: { label: string; link: string }[] = []
  const target = (link: unknown): string | undefined => {
    if (typeof link !== 'string') return undefined
    if (isUrl(link)) return link
    const id = byRoute.get(routeOfLink(link))
    return id === undefined ? undefined : `/${routeOf(id)}`
  }
  for (const item of Array.isArray(theme.nav) ? theme.nav.filter(isRecord) : []) {
    const label = asString(item.text)
    if (!label) continue
    const children = Array.isArray(item.items) ? item.items.filter(isRecord).flatMap((child) => (Array.isArray(child.items) ? child.items.filter(isRecord) : [child])) : []
    const link = target(item.link) ?? children.map((child) => target(child.link)).find((found) => found !== undefined)
    if (link) links.push({ label, link })
    if (!link) notes.push({ file: configName, message: `The header link "${label}" leads to something that was not imported, and was left out.` })
    else if (children.length > 0) notes.push({ file: configName, message: `The header menu "${label}" is written as one link, to the first of its entries. Shabd's header has no menus.` })
  }
  site.nav = links

  let nav: NavItem[] | undefined
  let navSource = failed
    ? `${configName} could not be run, so there are no entries: Shabd generates the sidebar from the folders.`
    : 'The config has no sidebar, so there are no entries: Shabd generates the sidebar from the folders.'
  if (theme.sidebar !== undefined) {
    const problems: string[] = []
    const read = vitepressSidebar(theme.sidebar, byRoute, problems)
    if (read.length > 0) {
      nav = read
      navSource = `From \`themeConfig.sidebar\` in ${configName}.`
    } else {
      navSource = `\`themeConfig.sidebar\` in ${configName} could not be read as a list of entries, so there are none: Shabd generates the sidebar from the folders.`
      notes.push({ file: configName, message: 'The sidebar is made by code that could not be run here. It was not imported.' })
    }
    for (const message of problems) notes.push({ file: configName, message })
  }
  if (isRecord(config.locales) && Object.keys(config.locales).length > 1) notes.push({ file: configName, message: 'The site has translations. Every page is imported, each language under its own folder, and nothing links them.' })

  return {
    tool: 'vitepress',
    contentDir,
    pages,
    publicDirs: [path.join(contentDir, 'public')],
    site,
    nav,
    navSource,
    links: { relative: 'file', prefixes: [site.base?.replace(/\/$/, '') ?? ''].filter(Boolean) },
    notes,
    // What is in public/ is served from the root, and goes to the new site's public/.
    place: (file) => (file.startsWith('public/') ? undefined : file),
    convert: (text, _page, links) => convertVitepressPage(text, { links }),
  }
}
