/**
 * Measures Shabd on sites far larger than its own docs.
 *
 *     node scripts/bench/run.mjs                          1,000 and 5,000 made-up pages
 *     node scripts/bench/run.mjs 200 2000                 other sizes
 *     node scripts/bench/run.mjs 5000 --corpus <folder>   real pages, from a folder of Markdown
 *     node scripts/bench/run.mjs 1000 --semantic          with embeddings for search by meaning
 *     node scripts/bench/run.mjs 1000 --only build,check  some of the measurements
 *
 * Build the package first (`npm run build`), and install Playwright's
 * Chromium (`npx playwright install chromium`): two of the measurements open
 * the site in a browser.
 *
 * For each size a site is written under .shabd/bench/, which Git ignores,
 * and these are measured, each in a process of its own:
 *
 *   scan     reading the config, the sidebar and every page's frontmatter
 *   build    `shabd build` with nothing cached, and what it wrote
 *   rebuild  the same build again, with every page's compilation cached
 *   check    `shabd check`
 *   dev      `shabd dev`: the first page on screen, a page not seen before, an edit
 *   browse   the built site: a page, the first search, the searches after it
 *
 * The results are printed, and written to .shabd/bench/results.json.
 */
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSite } from './make-site.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..', '..')
const work = path.join(root, '.shabd', 'bench')

const ALL = ['scan', 'build', 'rebuild', 'check', 'dev', 'browse']

function options(argv) {
  const sizes = []
  const chosen = { corpus: undefined, semantic: false, only: ALL }
  for (let index = 0; index < argv.length; index++) {
    const word = argv[index]
    if (word === '--corpus') chosen.corpus = path.resolve(argv[++index] ?? '')
    else if (word === '--semantic') chosen.semantic = true
    else if (word === '--only') chosen.only = (argv[++index] ?? '').split(',')
    else if (Number(word) > 0) sizes.push(Number(word))
    else throw new Error(`Not an option of this script: ${word}`)
  }
  const unknown = chosen.only.filter((name) => !ALL.includes(name))
  if (unknown.length) throw new Error(`Not a measurement: ${unknown.join(', ')}. They are: ${ALL.join(', ')}`)
  return { sizes: sizes.length ? sizes : [1000, 5000], ...chosen }
}

/** Run one measurement in a process of its own. What it printed goes to a log beside the site. */
function measure(what, dir, log) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, 'measure.mjs'), what, dir], { cwd: root })
    let printed = ''
    child.stdout.on('data', (chunk) => (printed += chunk))
    child.stderr.on('data', (chunk) => (printed += chunk))
    child.on('close', async (code) => {
      await writeFile(log, printed)
      const line = printed.split('\n').findLast((text) => text.startsWith('RESULT '))
      if (code === 0 && line) return resolve(JSON.parse(line.slice('RESULT '.length)))
      // What went wrong is the end of what it printed.
      resolve({ failed: `exit ${code}`, said: printed.trim().split('\n').slice(-6).join('\n') })
    })
  })
}

/** How much text the site holds: the pages' own words, before anything is added to them. */
async function words(dir) {
  let count = 0
  let bytes = 0
  const walk = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (/\.mdx?$/.test(entry.name)) {
        const text = await readFile(file, 'utf8')
        bytes += Buffer.byteLength(text)
        count += text.split(/\s+/).length
      }
    }
  }
  await walk(path.join(dir, 'content'))
  return { words: count, sourceMB: +(bytes / 1024 / 1024).toFixed(1) }
}

const seconds = (ms) => (ms === undefined ? 'n/a' : ms >= 10_000 ? `${(ms / 1000).toFixed(0)} s` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`)

/** The lines of the report for one site, from whatever was measured. */
function report(site) {
  const { scan, build, rebuild, check, dev, browse } = site.results
  const rows = []
  const row = (name, value) => rows.push(`  ${name.padEnd(34)} ${value}`)
  const failed = (name, result) => result?.failed && row(name, `failed (${result.failed})\n${result.said.replace(/^/gm, '      ')}`)

  row('pages', `${site.pages.toLocaleString('en')}, ${site.words.toLocaleString('en')} words, ${site.sourceMB} MB of Markdown`)
  if (scan && !failed('scan', scan)) row('reading the site', `${seconds(scan.ms)}, ${scan.memoryMB} MB`)
  if (build && !failed('build', build)) {
    row('build, nothing cached', `${seconds(build.ms)}, ${build.memoryMB} MB at most`)
    row('  written', `${build.files.toLocaleString('en')} files, ${build.distMB} MB`)
    row('  pages as HTML', `${build.htmlMB} MB: ${build.htmlMedianKB} KB the median page, ${build.htmlLargestKB} KB the largest`)
    row('  scripts and styles', `${build.scriptMB} MB`)
    if (build.indexMB !== null) row('  search index', `${build.indexMB} MB, ${build.indexGzipMB} MB compressed${build.sections ? `, ${build.sections.toLocaleString('en')} sections` : ''}`)
  }
  if (rebuild && !failed('rebuild', rebuild)) row('build again, pages cached', `${seconds(rebuild.ms)}, ${rebuild.memoryMB} MB at most`)
  if (check && !failed('check', check)) row('shabd check', `${seconds(check.ms)}, ${check.memoryMB} MB`)
  if (dev && !failed('dev', dev)) {
    row('shabd dev: listening', seconds(dev.listeningMs))
    row('  first page on screen', seconds(dev.firstPageMs))
    row('  a page not opened before', seconds(dev.newPageMs))
    row('  a page opened before', seconds(dev.seenPageMs))
    row('  an edit, save to screen', `${seconds(dev.editMs)} (the first: ${seconds(dev.firstEditMs)})`)
    row('  memory', `${dev.memoryMB} MB at most`)
  }
  if (browse && !failed('browse', browse)) {
    row('built site: a page ready', seconds(browse.pageReadyMs))
    row('  first search answered', seconds(browse.firstAnswerMs))
    row('  searches after it', `${seconds(browse.queryMs)} the median, ${seconds(browse.slowestQueryMs)} the slowest`)
  }
  return rows.join('\n')
}

const { sizes, corpus, semantic, only } = options(process.argv.slice(2))
await mkdir(work, { recursive: true })

const machine = `${os.cpus()[0]?.model ?? 'unknown processor'}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 1024 ** 3)} GB, ${os.type()} ${os.release()}, Node ${process.versions.node}`
console.log(`\n${machine}`)
console.log(corpus ? `Real pages, from ${corpus}` : 'Made-up pages (scripts/bench/make-site.mjs)')
console.log(semantic ? 'Search by keyword and by meaning: the build embeds every section\n' : 'Search by keyword only\n')

const sites = []
for (const size of sizes) {
  const name = `${corpus ? 'corpus' : 'site'}-${size}${semantic ? '-semantic' : ''}`
  const dir = path.join(work, name)
  // A site that is only browsed or checked is kept as it was built; anything else starts from nothing.
  const fresh = only.includes('scan') || only.includes('build')
  const pages = fresh ? await makeSite(dir, size, { corpus, semantic }) : null
  const site = { name, pages: pages?.length ?? size, ...(await words(dir)), results: {} }
  sites.push(site)
  console.log(`${name}: ${site.pages.toLocaleString('en')} pages`)

  for (const what of only) {
    process.stdout.write(`  ${what} … `)
    const started = Date.now()
    // The second build is the first one again, with what the first one cached.
    site.results[what] = await measure(what === 'rebuild' ? 'build' : what, dir, path.join(work, `${name}.${what}.log`))
    console.log(site.results[what].failed ? `failed: ${site.results[what].failed}` : `${((Date.now() - started) / 1000).toFixed(1)} s`)
  }
  console.log(`\n${report(site)}\n`)
}

await writeFile(path.join(work, 'results.json'), `${JSON.stringify({ machine, corpus: corpus ?? null, semantic, sites }, null, 2)}\n`)
console.log(`Written to ${path.relative(process.cwd(), path.join(work, 'results.json'))}`)
