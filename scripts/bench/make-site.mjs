/**
 * Writes a documentation site of any size, to measure Shabd on more pages
 * than its own docs have.
 *
 *     node scripts/bench/make-site.mjs <folder> <pages>
 *     node scripts/bench/make-site.mjs <folder> <pages> --corpus <folder of Markdown>
 *
 * Without `--corpus` the pages are made up. They are shaped like reference
 * documentation: sections of prose, lists, tables, callouts, code in six
 * languages and links to each other, with lengths spread the way real pages
 * are: most of them short, a few very long. The same number of pages always
 * gives the same site, so two runs measure the same thing.
 *
 * With `--corpus` the pages are real ones: the first Markdown files of that
 * folder, with the files that sit beside them. Their frontmatter is cut down
 * to a title and a description, because other tools give other meanings to
 * the keys Shabd reads.
 *
 * Either way the site gets a sidebar for each part of it, as a site this size
 * would have. A part of more than a few hundred pages is divided into its
 * folders, unless those are too small to be parts themselves: a glossary is
 * one long sidebar on the site it came from, and is one here.
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The most pages one sidebar is given. A part of the site with more is divided into its folders. */
const SIDEBAR_LIMIT = 300
/** A folder is divided only when one of the folders inside it holds at least this many pages. */
const SMALLEST_PART = 25

/* ───────────────────────────── made-up pages ───────────────────────────── */

/** Numbers that are the same on every run (mulberry32). */
function seeded(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NOUNS = `request response server client token session user account project workspace bucket object file folder record
table column index query filter page cursor limit quota key secret certificate region zone cluster node container image
volume snapshot backup replica shard queue topic message event webhook trigger job task worker schedule pipeline stage
build release deployment environment variable setting flag feature plugin module package version tag branch commit patch
schema migration model field type value option parameter argument header body payload status error warning log metric
trace span alert dashboard report role policy permission group team member invite audit cache proxy gateway router route
endpoint domain address port socket stream buffer chunk batch retry timeout deadline lock lease transaction tenant
subscription invoice plan usage export import template draft revision comment label owner viewer editor`.split(/\s+/)

const VERBS = `create update delete read write send receive return accept reject validate parse encode decode sign verify
store load cache expire retry queue schedule run stop start restart scale deploy mount attach detach list filter sort
merge split rotate revoke renew archive restore publish subscribe`.split(/\s+/)

const ADJECTIVES = `new existing default optional required valid invalid empty large small remote local public private
read-only temporary permanent signed encrypted pending active stale idle primary secondary upstream downstream current
previous next single shared nested regional global scoped anonymous verified`.split(/\s+/)

const PLACES = ['eu-west', 'eu-central', 'us-east', 'us-west', 'ap-south', 'ap-northeast', 'sa-east']
const SYLLABLES = 'ka ro ti ve lu na mi so de ra qui len tor bas mer cal dix fen gor hal jun'.split(' ')
const CALLOUTS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']

function writer(rand) {
  /** One of a list, the first ones far more often than the last: a few words do most of the work, as in real text. */
  const pick = (list) => list[Math.min(list.length - 1, Math.floor((list.length + 1) ** rand()) - 1)]
  const any = (list) => list[Math.floor(rand() * list.length)]
  const between = (low, high) => low + Math.floor(rand() * (high - low + 1))
  const chance = (odds) => rand() < odds
  /** Roughly bell-shaped, from -3 to 3. */
  const bell = () => (rand() + rand() + rand() + rand() + rand() + rand() - 3) * 1.41

  const cap = (word) => word[0].toUpperCase() + word.slice(1)
  const third = (verb) => (/(s|sh|ch|x)$/.test(verb) ? `${verb}es` : /[^aeiou]y$/.test(verb) ? `${verb.slice(0, -1)}ies` : `${verb}s`)
  const plural = (noun) => (/(s|sh|ch|x)$/.test(noun) ? `${noun}es` : /[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`)
  const article = (word) => (/^[aeiou]/.test(word) ? 'an' : 'a')
  const thing = () => (chance(0.45) ? `${pick(ADJECTIVES)} ${pick(NOUNS)}` : pick(NOUNS))
  const a = () => {
    const words = thing()
    return chance(0.5) ? `the ${words}` : `${article(words)} ${words}`
  }

  /** A name nobody else has, so that the site has rare words as well as common ones. */
  const coined = () => cap(Array.from({ length: between(2, 3) }, () => any(SYLLABLES)).join(''))
  const camel = () => `${any(VERBS)}${cap(any(NOUNS))}${chance(0.4) ? cap(any(NOUNS)) : ''}`
  const snake = () => `${any(['max', 'min', 'default', 'allow', 'enable', 'skip'])}_${any(NOUNS)}_${any(['count', 'size', 'ttl', 'limit', 'mode', 'ms'])}`
  const dotted = () => `${any(NOUNS)}.${any(NOUNS)}.${any(['enabled', 'ttl', 'limit', 'mode', 'region', 'size'])}`
  const identifier = () => any([camel, camel, snake, dotted])()
  const literal = () => any([`\`${between(1, 900)}\``, '`true`', '`false`', `\`"${any(PLACES)}"\``, `\`${between(1, 60)}s\``, '`null`'])

  const SENTENCES = [
    () => `${cap(a())} ${third(pick(VERBS))} ${a()} for each ${thing()}.`,
    () => `When ${a()} ${third(pick(VERBS))}, the ${pick(NOUNS)} ${third(pick(VERBS))} ${a()} and the ${pick(NOUNS)} is left as it was.`,
    () => `To ${pick(VERBS)} ${a()}, set \`${identifier()}\` to ${literal()}.`,
    () => `Use \`${identifier()}\` to ${pick(VERBS)} ${a()} before the ${pick(NOUNS)} ${third(pick(VERBS))} it.`,
    () => `${cap(plural(pick(NOUNS)))} that are ${pick(ADJECTIVES)} are not ${pick(VERBS)}ed until the ${pick(NOUNS)} is ${pick(ADJECTIVES)}.`,
    () => `The ${pick(NOUNS)} must be ${pick(ADJECTIVES)}, or the ${pick(NOUNS)} ${third(pick(VERBS))} the ${pick(NOUNS)} with an error.`,
    () => `By default ${a()} ${third(pick(VERBS))} up to ${between(2, 500)} ${plural(pick(NOUNS))} in one ${pick(NOUNS)}.`,
    () => `This is the same ${pick(NOUNS)} that \`${identifier()}\` returns, with the ${pick(ADJECTIVES)} ${plural(pick(NOUNS))} left out.`,
    () => `If the ${pick(NOUNS)} does not ${pick(VERBS)} within ${between(1, 90)} seconds, the ${pick(NOUNS)} is ${pick(VERBS)}ed again.`,
    () => `${cap(a())} in ${any(PLACES)} can ${pick(VERBS)} ${plural(pick(NOUNS))} from any ${pick(NOUNS)} of the same ${pick(NOUNS)}.`,
    () => `It takes ${article(pick(ADJECTIVES))} ${thing()} and ${a()}, and gives back the ${pick(NOUNS)} it made.`,
    () => `Nothing is ${pick(VERBS)}ed until you ${pick(VERBS)} the ${pick(NOUNS)}, so ${a()} can be ${pick(VERBS)}ed more than once.`,
  ]
  const sentence = () => any(SENTENCES)()
  const paragraph = () => Array.from({ length: between(2, 6) }, sentence).join(' ')
  const heading = () => cap(any([() => `${pick(VERBS)} ${a()}`, () => `${plural(pick(NOUNS))} and ${plural(pick(NOUNS))}`, () => `how ${plural(thing())} work`, () => `${pick(ADJECTIVES)} ${plural(pick(NOUNS))}`])())

  const CODE = {
    ts: () => {
      const name = camel()
      const lines = [`import { createClient } from '@acme/sdk'`, '', `const client = createClient({ token: process.env.ACME_TOKEN })`, '']
      for (let block = between(1, 4); block > 0; block--) {
        const fn = camel()
        const noun = any(NOUNS)
        lines.push(
          `export async function ${fn}(${noun}: string, limit = ${between(10, 200)}) {`,
          `  const { items } = await client.${plural(any(NOUNS))}.list({ ${noun}, limit })`,
          `  return items.filter((item) => item.status === '${pick(ADJECTIVES)}')`,
          '}',
          '',
        )
      }
      lines.push(`console.log(await ${name}('${any(PLACES)}'))`)
      return lines
    },
    js: () => {
      const lines = [`const ${any(NOUNS)} = require('@acme/sdk')`, '']
      for (let block = between(1, 3); block > 0; block--) {
        lines.push(
          `async function ${camel()}(id) {`,
          `  const response = await fetch(\`https://api.acme.test/v1/${plural(any(NOUNS))}/\${id}\`)`,
          `  if (!response.ok) throw new Error(\`${cap(pick(NOUNS))} \${id}: \${response.status}\`)`,
          '  return response.json()',
          '}',
          '',
        )
      }
      return lines.slice(0, -1)
    },
    sh: () =>
      Array.from({ length: between(1, 6) }, () =>
        any([
          () => `acme ${any(NOUNS)} ${any(VERBS)} --region ${any(PLACES)} --name ${any(NOUNS)}-${between(1, 99)}`,
          () => `acme ${any(NOUNS)} list --format json | jq '.items[].${any(NOUNS)}'`,
          () => `curl -H "Authorization: Bearer $ACME_TOKEN" https://api.acme.test/v1/${plural(any(NOUNS))}`,
          () => `export ACME_${any(NOUNS).toUpperCase()}=${between(1, 999)}`,
        ])(),
      ),
    yaml: () => {
      const lines = [`${any(NOUNS)}:`]
      for (let key = between(2, 9); key > 0; key--) {
        lines.push(`  ${snake()}: ${any([between(1, 900), 'true', 'false', any(PLACES)])}`)
        if (chance(0.25)) lines.push(`  ${plural(any(NOUNS))}:`, `    - ${any(NOUNS)}-${between(1, 9)}`, `    - ${any(NOUNS)}-${between(1, 9)}`)
      }
      return lines
    },
    json: () => {
      const lines = ['{', `  "id": "${any(NOUNS)}_${between(1000, 9999)}",`]
      for (let key = between(2, 8); key > 0; key--) lines.push(`  "${any(NOUNS)}": ${any([between(1, 900), 'true', 'null', `"${any(PLACES)}"`])},`)
      lines.push(`  "status": "${pick(ADJECTIVES)}"`, '}')
      return lines
    },
    py: () => {
      const lines = ['from acme import Client', '', 'client = Client(token=os.environ["ACME_TOKEN"])', '']
      for (let block = between(1, 3); block > 0; block--) {
        const noun = any(NOUNS)
        lines.push(
          `def ${any(VERBS)}_${noun}(${noun}_id: str, limit: int = ${between(10, 200)}):`,
          `    ${plural(noun)} = client.${plural(noun)}.list(${noun}_id, limit=limit)`,
          `    return [item for item in ${plural(noun)} if item.status == "${pick(ADJECTIVES)}"]`,
          '',
        )
      }
      return lines.slice(0, -1)
    },
  }
  const code = () => {
    const language = any(Object.keys(CODE))
    const title = chance(0.2) ? ` title="${any(NOUNS)}.${language}"` : ''
    return ['```' + language + title, ...CODE[language](), '```'].join('\n')
  }

  const list = () => {
    const ordered = chance(0.3)
    return Array.from({ length: between(3, 7) }, (_, index) => `${ordered ? `${index + 1}.` : '-'} ${sentence()}`).join('\n')
  }
  const table = () =>
    ['| Name | Type | Description |', '| --- | --- | --- |', ...Array.from({ length: between(3, 9) }, () => `| \`${identifier()}\` | ${any(['text', 'number', 'boolean', 'list', 'object'])} | ${sentence()} |`)].join('\n')
  const callout = () => `> [!${any(CALLOUTS)}]\n> ${sentence()} ${sentence()}`

  return { any, between, chance, bell, cap, coined, sentence, paragraph, heading, code, list, table, callout, plural, pick }
}

/** One made-up page. `links` are other pages it may point to, as paths from the content folder. */
function page(w, file, title, links) {
  const blocks = [w.paragraph()]
  // Most pages are a few sections long and a few are very long, as in real documentation.
  const sections = Math.max(1, Math.min(40, Math.round(Math.exp(1.25 + 0.6 * w.bell()))))
  for (let section = 0; section < sections; section++) {
    blocks.push(`## ${w.heading()}`)
    for (let paragraphs = w.between(1, 3); paragraphs > 0; paragraphs--) blocks.push(w.paragraph())
    if (w.chance(0.35)) blocks.push(w.code())
    if (w.chance(0.3)) blocks.push(w.list())
    if (w.chance(0.12)) blocks.push(w.table())
    if (w.chance(0.1)) blocks.push(w.callout())
    if (w.chance(0.25)) blocks.push(`### ${w.heading()}`, w.paragraph(), ...(w.chance(0.4) ? [w.code()] : []))
    if (links.length && w.chance(0.5)) {
      const to = w.any(links)
      blocks.push(`See [${to.title}](${path.posix.relative(path.posix.dirname(file), to.file)}) for how the two fit together.`)
    }
  }
  return `---\ntitle: ${title}\ndescription: ${w.sentence().replace(/`/g, '')}\n---\n\n${blocks.join('\n\n')}\n`
}

async function generated(dir, count) {
  const w = writer(seeded(count))
  // Parts of about 125 pages, in five folders each.
  const areas = Math.max(2, Math.round(count / 125))
  const slugs = new Set()
  const slug = (words) => {
    const base = words.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    let name = base
    for (let n = 2; slugs.has(name); n++) name = `${base}-${n}`
    slugs.add(name)
    return name
  }

  // The home page and one page for each part come out of the count; the rest are spread over the folders.
  const plan = []
  const remaining = count - 1 - areas
  for (let index = 0; index < areas; index++) {
    const name = w.coined()
    const area = { title: `${name} ${w.cap(w.pick(NOUNS))}`, dir: slug(name), topics: [] }
    for (let topic = 0; topic < 5; topic++) area.topics.push({ dir: slug(w.plural(w.any(NOUNS))), pages: [] })
    plan.push(area)
  }
  for (let index = 0; index < remaining; index++) {
    const area = plan[index % areas]
    const topic = area.topics[Math.floor(index / areas) % area.topics.length]
    const title = w.heading()
    topic.pages.push({ title, file: `${area.dir}/${topic.dir}/${slug(title)}.md` })
  }

  const files = new Map()
  for (const area of plan) {
    const pages = area.topics.flatMap((topic) => topic.pages)
    for (const entry of pages) files.set(entry.file, page(w, entry.file, entry.title, pages))
    files.set(
      `${area.dir}/index.md`,
      `---\ntitle: ${area.title}\ndescription: ${w.sentence().replace(/`/g, '')}\n---\n\n${w.paragraph()}\n\n${pages
        .slice(0, 12)
        .map((entry) => `- [${entry.title}](${path.posix.relative(area.dir, entry.file)})`)
        .join('\n')}\n`,
    )
  }
  files.set(
    'index.md',
    `---\ntitle: Acme documentation\ndescription: A made-up site of ${count} pages.\n---\n\n${plan.map((area) => `- [${area.title}](${area.dir}/index.md)`).join('\n')}\n`,
  )

  for (const [file, text] of files) {
    await mkdir(path.join(dir, 'content', path.dirname(file)), { recursive: true })
    await writeFile(path.join(dir, 'content', file), text)
  }
  return { pages: [...files.keys()], nav: plan.slice(0, 5).map((area) => ({ label: area.title, link: `/${area.dir}` })) }
}

/* ────────────────────────────── real pages ─────────────────────────────── */

const isPage = (name) => /\.mdx?$/.test(name)

/** Every folder under `root` that holds a page, with its pages and the other files beside them. */
async function folders(root, at = '') {
  const found = []
  const entries = (await readdir(path.join(root, at), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
  const files = entries.filter((entry) => entry.isFile() && !entry.name.startsWith('.')).map((entry) => entry.name)
  if (files.some(isPage)) found.push({ dir: at, pages: files.filter(isPage), others: files.filter((name) => !isPage(name)) })
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') found.push(...(await folders(root, path.posix.join(at, entry.name))))
  }
  return found
}

/**
 * MDN, the corpus this was first run on, writes a link to one of its pages as
 * `/en-US/docs/Web/CSS/color`, and keeps the page in `web/css/color/`. Such a
 * link is rewritten to where the page is in the copy, so that the links of
 * the site lead somewhere, as a real site's do. No other link is touched.
 */
const MDN_LINK = /\]\(\/en-US\/docs\/([^)\s#]*)/g
const mdnLink = (_link, slug) =>
  `](/${slug.toLowerCase().replaceAll('::', '_doublecolon_').replaceAll(':', '_colon_').replaceAll('*', '_star_')}`

/** The text of a frontmatter value that is one line of plain text, or nothing. */
function plain(frontmatter, key) {
  const match = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(frontmatter)
  return match && !/^[>|[{]/.test(match[1].trim()) ? match[1].trim() : undefined
}

async function copied(dir, count, corpus) {
  const pages = []
  for (const folder of await folders(corpus)) {
    if (pages.length >= count) break
    await mkdir(path.join(dir, 'content', folder.dir), { recursive: true })
    for (const name of folder.pages) {
      if (pages.length >= count) break
      const text = await readFile(path.join(corpus, folder.dir, name), 'utf8')
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
      const kept = match ? ['title', 'description'].flatMap((key) => (plain(match[1], key) ? [`${key}: ${plain(match[1], key)}`] : [])) : []
      const body = (match ? text.slice(match[0].length) : text).replace(MDN_LINK, mdnLink)
      await writeFile(path.join(dir, 'content', folder.dir, name), `${kept.length ? `---\n${kept.join('\n')}\n---\n\n` : ''}${body}`)
      pages.push(path.posix.join(folder.dir, name))
    }
    // Pictures and other files a page of this folder may name.
    for (const name of folder.others) await copyFile(path.join(corpus, folder.dir, name), path.join(dir, 'content', folder.dir, name))
  }
  if (!pages.some((file) => /^index\.mdx?$/.test(file))) {
    await writeFile(path.join(dir, 'content', 'index.md'), `---\ntitle: Imported pages\n---\n\n${pages.length} pages from another site.\n`)
    pages.push('index.md')
  }
  return { pages, nav: [] }
}

/* ─────────────────────────────── the site ──────────────────────────────── */

/**
 * A sidebar for each part of the site. A part is a top-level folder, unless
 * it holds more pages than one sidebar should: then its folders are parts
 * themselves, and so on down.
 */
function sidebars(pages) {
  const parts = []
  const label = (prefix) => JSON.stringify(prefix ? prefix.slice(0, -1).split('/').pop() : 'Home')
  const divide = (prefix) => {
    const inside = pages.filter((file) => file.startsWith(prefix))
    const rest = inside.map((file) => file.slice(prefix.length))
    const sizes = new Map()
    for (const file of rest) if (file.includes('/')) sizes.set(file.split('/')[0], (sizes.get(file.split('/')[0]) ?? 0) + 1)
    const children = [...sizes.keys()]
    // Dividing helps when the folders inside are parts in their own right. A glossary of six hundred
    // terms, each in a folder of its own, is one long list however it is cut, and stays one sidebar.
    const divisible = Math.max(0, ...sizes.values()) >= SMALLEST_PART
    if (prefix && (inside.length <= SIDEBAR_LIMIT || !divisible)) {
      return parts.push(`/${prefix}:\n  - category: ${label(prefix)}\n    autogenerate: ${prefix.slice(0, -1)}\n`)
    }
    // Divided: the folder's own pages keep a short sidebar here, and each folder inside gets one of its own.
    const own = rest.filter((file) => !file.includes('/'))
    if (own.length) {
      parts.push(`/${prefix}:\n  - category: ${label(prefix)}\n    items:\n${own.map((file) => `      - ${JSON.stringify(prefix + file)}`).join('\n')}\n`)
    }
    for (const child of children) divide(`${prefix}${child}/`)
  }
  divide('')
  return parts.join('\n')
}

/**
 * Write a site of `count` pages to `dir`, replacing what is there.
 * Returns the pages it wrote, as paths inside the content folder.
 */
export async function makeSite(dir, count, options = {}) {
  await rm(dir, { recursive: true, force: true })
  await mkdir(path.join(dir, 'content'), { recursive: true })
  const { pages, nav } = options.corpus ? await copied(dir, count, options.corpus) : await generated(dir, count)

  const config = [
    'site:',
    '  title: Acme',
    `  description: A site of ${pages.length} pages, for measuring.`,
    '  url: https://bench.example',
    ...(nav.length ? ['  nav:', ...nav.map((item) => `    - { label: ${JSON.stringify(item.label)}, link: ${item.link} }`)] : []),
    'features:',
    // Embeddings are measured on their own: they take far longer than everything else together.
    `  search: { semantic: ${options.semantic === true} }`,
    '',
  ]
  await writeFile(path.join(dir, 'shabd.config.yaml'), config.join('\n'))
  await writeFile(path.join(dir, 'sidebar.yaml'), sidebars(pages))
  return pages
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, count, flag, corpus] = process.argv.slice(2)
  if (!dir || !Number(count) || (flag !== undefined && (flag !== '--corpus' || !corpus))) {
    console.error('Usage: node scripts/bench/make-site.mjs <folder> <pages> [--corpus <folder of Markdown>]')
    process.exit(1)
  }
  const pages = await makeSite(path.resolve(dir), Number(count), corpus ? { corpus: path.resolve(corpus) } : {})
  console.log(`${pages.length} pages written to ${dir}`)
}
