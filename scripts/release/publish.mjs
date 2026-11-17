/**
 * Publishes Shabd to npm.
 *
 *     npm run release                       publish whatever is not on npm yet
 *     npm run release -- --dry-run          prepare everything and publish nothing
 *     npm run release -- --out <directory>  the same, and leave the four packages there to look at
 *
 * npm refused the name `shabd` as too close to other packages, so Shabd goes
 * out under two names. `@himanshoe/shabd` is what the package is called in
 * this repository. `shabd-docs` is the same files with the name changed
 * wherever it is written. Each has its starter beside it, which makes four
 * packages:
 *
 *     @himanshoe/shabd           npm create @himanshoe/shabd
 *     @himanshoe/create-shabd
 *     shabd-docs                 npm create shabd-docs
 *     create-shabd-docs
 *
 * Run it in a terminal of your own: npm asks for the account's second factor
 * before a package goes out. A version that is already on npm is skipped, so
 * running it again after something went wrong picks up where it stopped.
 *
 * The Release workflow on GitHub runs it too (.github/workflows/release.yml).
 * There nobody is logged in: each package on npmjs.com names that workflow
 * as a trusted publisher.
 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The workspaces that are published, and the second name each also goes out under. */
export const PACKAGES = [
  { directory: 'packages/shabd', alias: 'shabd-docs' },
  { directory: 'packages/create-shabd', alias: 'create-shabd-docs' },
]

/** The text of one file of a package, with every name it is published under changed to its second name. */
export function renamed(text, names) {
  let result = text
  for (const [from, to] of names) result = result.split(from).join(to)
  return result
}

/** What a second-name copy says about itself at the top of its readme. */
export function aliasNote(name, original) {
  return (
    `> This is [\`${original}\`](https://www.npmjs.com/package/${original}) under a second name. ` +
    `Both are published from the same source and hold the same files, so \`${name}\` and \`${original}\` can be used ` +
    `interchangeably. Pick one and stay with it.\n`
  )
}

const run = (command, args, options = {}) => spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options })

async function filesUnder(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await filesUnder(full)))
    else found.push(full)
  }
  return found
}

/** Unpack a tarball made by `npm pack` and return the directory of the package inside it. */
async function unpack(tarball, into) {
  await mkdir(into, { recursive: true })
  const done = run('tar', ['-xzf', tarball, '-C', into])
  if (done.status !== 0) throw new Error(`Could not unpack ${tarball}: ${done.stderr}`)
  return path.join(into, 'package')
}

async function main(argv) {
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : undefined
  if (argv.includes('--out') && !out) throw new Error('--out needs a directory')
  const dryRun = argv.includes('--dry-run') || out !== undefined
  const manifests = await Promise.all(
    PACKAGES.map(async ({ directory }) => JSON.parse(await readFile(path.join(root, directory, 'package.json'), 'utf8'))),
  )
  /** Every name is changed in every package: the starter's files name the package it starts. */
  const names = PACKAGES.map(({ alias }, index) => [manifests[index].name, alias])

  if (!dryRun) {
    const dirty = run('git', ['status', '--porcelain']).stdout.trim()
    if (dirty) throw new Error(`The working tree has changes that are not committed. Publish what a commit holds:\n${dirty}`)
    // In the release workflow nobody is logged in: npm takes GitHub's word for which workflow is publishing.
    if (process.env.GITHUB_ACTIONS) {
      console.log('Publishing from GitHub Actions, as a trusted publisher.\n')
    } else {
      const who = run('npm', ['whoami'])
      if (who.status !== 0) throw new Error('Not logged in to npm. Run `npm login` first.')
      console.log(`Publishing as ${who.stdout.trim()}.\n`)
    }
  }

  const work = out ? path.resolve(out) : await mkdtemp(path.join(tmpdir(), 'shabd-release-'))
  await mkdir(work, { recursive: true })
  if (out && (await readdir(work)).length > 0) throw new Error(`${work} is not empty`)
  const outcomes = []
  try {
    // Pack each workspace once. `shabd` builds itself first (its `prepack` script).
    const tarballs = []
    for (const [index, { directory }] of PACKAGES.entries()) {
      // The packed file is found by looking for it. What `npm pack --json` prints differs between npm 10 and 12.
      const before = new Set(await readdir(work))
      const packed = run('npm', ['pack', '--pack-destination', work], { cwd: path.join(root, directory) })
      if (packed.status !== 0) throw new Error(`npm pack failed in ${directory}:\n${packed.stderr}`)
      const made = (await readdir(work)).filter((file) => file.endsWith('.tgz') && !before.has(file))
      if (made.length !== 1) throw new Error(`Expected npm pack to leave one file in ${work} for ${directory}, found ${made.length}.`)
      tarballs[index] = path.join(work, made[0])
    }

    // The package under its own name first, then its starter, then the same two under their second names.
    const targets = [
      ...PACKAGES.map((_, index) => ({ index, name: manifests[index].name, alias: false })),
      ...PACKAGES.map(({ alias }, index) => ({ index, name: alias, alias: true })),
    ]

    for (const target of targets) {
      const { version } = manifests[target.index]
      const label = `${target.name}@${version}`
      if (run('npm', ['view', label, 'version']).stdout.trim() === version) {
        console.log(`${label} is already on npm.\n`)
        outcomes.push([label, 'already published'])
        continue
      }

      const directory = await unpack(tarballs[target.index], path.join(work, target.name.replace(/[@/]/g, '_')))
      if (target.alias) {
        for (const file of await filesUnder(directory)) {
          const bytes = await readFile(file)
          if (bytes.includes(0)) continue // not text
          const text = bytes.toString('utf8')
          let next = renamed(text, names)
          if (path.relative(directory, file) === 'README.md') {
            const original = manifests[target.index].name
            // After the title, which is the first line.
            next = next.replace(/^(#[^\n]*\n)/, `$1\n${aliasNote(target.name, original)}`)
          }
          if (next !== text) await writeFile(file, next)
        }
      }
      const written = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')).name
      if (written !== target.name) throw new Error(`Expected ${target.name} in ${directory}, found ${written}`)

      // Under its own name a package goes out exactly as `npm pack` made it. Under its second name it is the
      // changed files, and its scripts stay out of it: there is nothing to build in an unpacked package.
      const what = target.alias ? [directory, '--ignore-scripts'] : [tarballs[target.index]]
      console.log(`${dryRun ? 'Would publish' : 'Publishing'} ${label}…`)
      const published = spawnSync('npm', ['publish', ...what, '--access', 'public', ...(dryRun ? ['--dry-run'] : [])], {
        cwd: work,
        encoding: 'utf8',
        // A real run needs the terminal: npm asks for the second factor there.
        stdio: dryRun ? 'pipe' : 'inherit',
      })
      const ok = published.status === 0
      if (dryRun && ok) {
        // npm's report, where this npm writes one that can be read.
        const report = `${published.stdout}${published.stderr}`
        const read = (field) => new RegExp(`${field}:\\s*(.+)`).exec(report)?.[1]?.trim()
        const facts = [read('total files') && `${read('total files')} files`, read('package size') && `${read('package size')} packed`]
        console.log(`  ${facts.filter(Boolean).join(', ') || 'packed'}, as ${target.name}`)
      } else if (dryRun) {
        console.error(published.stderr)
      }
      outcomes.push([label, ok ? (dryRun ? 'ready' : 'published') : 'FAILED'])
      console.log(ok ? '' : `\n${label} was not published. Carrying on with the rest.\n`)
    }
  } finally {
    if (!out) await rm(work, { recursive: true, force: true })
  }

  console.log(dryRun ? 'Dry run. Nothing was published:' : 'Done:')
  for (const [label, outcome] of outcomes) console.log(`  ${outcome.padEnd(18)} ${label}`)
  return outcomes.some(([, outcome]) => outcome === 'FAILED') ? 1 : 0
}

// Run only as a program: the tests import the pieces above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
