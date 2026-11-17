/**
 * Writes a new Shabd site into a folder.
 *
 *     npm create shabd my-docs
 *
 * The site is the contents of ../template, copied with two things filled in:
 * the site's title and its theme preset. A package.json is written beside
 * them. Nothing here depends on Shabd itself, so the starter stays a few
 * kilobytes; `shabd check` in the new site is what validates the result.
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const TEMPLATE = fileURLToPath(new URL('../template', import.meta.url))

/** The version of Shabd a new site asks for, unless `--shabd` says otherwise. */
export const SHABD_RANGE = '^0.1.0'
/** What Shabd needs beside it. Kept equal to its peer dependencies by a test. */
export const PEERS = { react: '^19.3.1', 'react-dom': '^19.3.1' }

/** Files that may already be in a folder we are asked to fill. */
const HARMLESS = new Set(['.git', '.DS_Store'])
/** npm leaves `.gitignore` out of published packages, so the template keeps it under another name. */
const RENAMED = { _gitignore: '.gitignore' }

const HELP = `Usage: create-shabd [directory] [options]
       npm create shabd@latest [directory] -- [options]

Writes a small Shabd site into the directory (default: my-docs).

Options:
  --title <text>    The site's title (default: taken from the directory name)
  --preset <name>   A built-in theme, such as forest or macos (default: shabd)
  --shabd <spec>    What to install as "shabd": a version range, or a path or
                    tarball of a local build (default: ${SHABD_RANGE})
  --force           Write into a directory that is not empty. Files that are
                    already there are kept, not replaced.
  -h, --help        Show this help
`

/** `my-docs` and `my_docs` become "My docs". */
export function titleFromDirectory(directory) {
  const words = path.basename(path.resolve(directory)).replace(/[-_.]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Docs'
}

/** A valid npm package name for the folder, or a safe default. */
function packageName(directory) {
  const name = path
    .basename(path.resolve(directory))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
  return name || 'docs'
}

async function filesUnder(directory, prefix = '') {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name)
    if (entry.isDirectory()) found.push(...(await filesUnder(path.join(directory, entry.name), relative)))
    else found.push(relative)
  }
  return found.sort()
}

/**
 * Create the site. Returns the files written and the files left alone because
 * they were already there, both relative to the directory.
 *
 * @param {{ directory: string, title?: string, preset?: string, shabd?: string, force?: boolean }} options
 * @returns {Promise<{ directory: string, written: string[], kept: string[] }>}
 */
export async function create(options) {
  const directory = path.resolve(options.directory)
  const title = options.title?.trim() || titleFromDirectory(directory)
  const preset = options.preset ?? 'shabd'
  if (!/^[a-z][a-z0-9-]*$/.test(preset)) {
    throw new Error(`"${preset}" does not look like a preset name. They are lower-case words such as forest or macos.`)
  }

  const existing = existsSync(directory) ? (await readdir(directory)).filter((name) => !HARMLESS.has(name)) : []
  if (existing.length > 0 && !options.force) {
    throw new Error(
      `${directory} is not empty (it has ${existing.slice(0, 3).join(', ')}${existing.length > 3 ? ', …' : ''}).\n` +
        `Choose another directory, or pass --force to add the site's files to it. Files already there are kept.`,
    )
  }

  // Both go into YAML. A JSON string is also a YAML string, whatever characters it holds.
  const values = { title: JSON.stringify(title), description: JSON.stringify(`Documentation for ${title}.`), preset }
  const fill = (text) => text.replace(/\{\{(\w+)\}\}/g, (whole, key) => values[key] ?? whole)

  const files = new Map()
  for (const file of await filesUnder(TEMPLATE)) {
    const target = path.join(path.dirname(file), RENAMED[path.basename(file)] ?? path.basename(file))
    files.set(target, fill(await readFile(path.join(TEMPLATE, file), 'utf8')))
  }
  files.set(
    'package.json',
    `${JSON.stringify(
      {
        name: packageName(directory),
        private: true,
        type: 'module',
        scripts: { dev: 'shabd dev', build: 'shabd build', preview: 'shabd preview', check: 'shabd check' },
        dependencies: { ...PEERS, shabd: options.shabd ?? SHABD_RANGE },
      },
      null,
      2,
    )}\n`,
  )

  const written = []
  const kept = []
  for (const [file, contents] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const target = path.join(directory, file)
    if (existsSync(target)) {
      kept.push(file)
      continue
    }
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, contents)
    written.push(file)
  }
  return { directory, written, kept }
}

/** The command line. Returns the exit code. */
export async function main(argv, print = console.log, printError = console.error) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        title: { type: 'string' },
        preset: { type: 'string' },
        shabd: { type: 'string' },
        force: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (error) {
    printError(`${error.message}\n\n${HELP}`)
    return 1
  }
  if (parsed.values.help) {
    print(HELP)
    return 0
  }
  if (parsed.positionals.length > 1) {
    // `npm create shabd my-docs --preset forest` reaches us as `my-docs forest`: npm keeps the option's name.
    printError(
      `Expected one directory, got ${parsed.positionals.length}: ${parsed.positionals.join(' ')}\n` +
        `Through npm create, options need "--" before them: npm create shabd@latest my-docs -- --preset forest\n\n${HELP}`,
    )
    return 1
  }

  const directory = parsed.positionals[0] ?? 'my-docs'
  let result
  try {
    result = await create({ directory, ...parsed.values })
  } catch (error) {
    printError(error.message)
    return 1
  }

  // Relative when the site is below where we are, as it usually is; otherwise the whole path.
  const below = path.relative(process.cwd(), result.directory) || '.'
  const shown = below.startsWith('..') ? result.directory : below
  print(`Created a Shabd site in ${shown}:\n`)
  for (const file of result.written) print(`  ${file}`)
  if (result.kept.length > 0) {
    print(`\nAlready there, left as they were:\n`)
    for (const file of result.kept) print(`  ${file}`)
  }
  print(`\nNext:\n`)
  if (shown !== '.') print(`  cd ${shown}`)
  print(`  npm install`)
  print(`  npm run dev\n`)
  return 0
}
