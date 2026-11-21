/**
 * Writes the version of the next release everywhere it is written.
 *
 *     node scripts/release/set-version.mjs 0.1.1
 *
 * Both packages carry the same version. It is also a constant in the code,
 * the range a new site asks for, the name of the packed file in two guides,
 * and two entries in the lockfile. Setting the version that is already set
 * changes nothing, so a release can be run again after it stopped half way.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/

/** Whether `next` comes before `current`, by the three numbers. A pre-release label is not weighed. */
export function isBefore(next, current) {
  const numbers = (version) => version.split('-')[0].split('.').map(Number)
  const [a, b] = [numbers(next), numbers(current)]
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] < b[index]
  }
  return false
}

const manifest = (text, _from, to) => text.replace(/^(  "version": )"[^"]+"/m, `$1"${to}"`)
const everywhere = (find) => (text, from, to) => text.split(find(from)).join(find(to))

/** Each file that holds the version, and how its text changes from one version to the next. */
export const PLACES = [
  ['packages/shabd/package.json', manifest],
  ['packages/create-shabd/package.json', manifest],
  ['packages/shabd/src/shared/version.ts', everywhere((version) => `VERSION = '${version}'`)],
  ['packages/create-shabd/src/create.js', everywhere((version) => `SHABD_RANGE = '^${version}'`)],
  ['docs/content/guide/installation.md', everywhere((version) => `himanshoe-shabd-${version}.tgz`)],
  ['CONTRIBUTING.md', everywhere((version) => `himanshoe-shabd-${version}.tgz`)],
  [
    'package-lock.json',
    (text, _from, to) => {
      const lock = JSON.parse(text)
      for (const workspace of ['packages/shabd', 'packages/create-shabd']) lock.packages[workspace].version = to
      // Written back with the line endings it had: Git on Windows may have checked it out with CRLF.
      const written = `${JSON.stringify(lock, null, 2)}\n`
      return text.includes('\r\n') ? written.replace(/\n/g, '\r\n') : written
    },
  ],
]

/** The new text of every place, without writing anything. Throws for a version that cannot be released. */
export async function plan(version, directory = root) {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a version. Write three numbers, such as 0.1.1.`)
  const current = JSON.parse(await readFile(path.join(directory, 'packages/shabd/package.json'), 'utf8')).version
  if (isBefore(version, current)) throw new Error(`${version} comes before ${current}, the version there is now.`)
  const changes = []
  for (const [file, change] of PLACES) {
    const before = await readFile(path.join(directory, file), 'utf8')
    const after = change(before, current, version)
    if (version !== current && after === before) throw new Error(`${file} does not hold ${current} where it was expected.`)
    changes.push({ file, before, after })
  }
  return { current, changes }
}

// Run only as a program: the tests import the pieces above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = process.argv[2] ?? ''
    const { current, changes } = await plan(version)
    for (const { file, before, after } of changes) if (after !== before) await writeFile(path.join(root, file), after)
    console.log(version === current ? `The version is ${current} already.` : `${current} → ${version} in ${changes.length} files.`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
