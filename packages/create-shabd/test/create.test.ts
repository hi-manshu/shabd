import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { collectProblems } from '../../shabd/src/node/check.js'
import { createContext } from '../../shabd/src/node/context.js'
import { PEERS, SHABD_RANGE, create, main, titleFromDirectory } from '../src/create.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const BIN = path.join(here, '..', 'bin', 'create-shabd.js')
// Inside the repository, so that a generated site resolves the workspace's packages.
const TMP = path.join(here, '.tmp')
let scratch: string

beforeAll(async () => {
  await mkdir(TMP, { recursive: true })
  scratch = await mkdtemp(path.join(TMP, 'run-'))
})
afterAll(() => rm(scratch, { recursive: true, force: true }))

const FILES = [
  '.gitignore',
  'content/guide/getting-started.md',
  'content/guide/writing.md',
  'content/index.mdx',
  'package.json',
  'shabd.config.yaml',
  'sidebar.yaml',
]

/** Everything `shabd check` would say about a site. */
async function problemsOf(directory: string) {
  const context = await createContext(directory, { dev: false })
  const { problems } = await collectProblems(context)
  return { problems, context }
}

describe('create-shabd', () => {
  it('writes a site that Shabd accepts as it is', async () => {
    const directory = path.join(scratch, 'my-docs')
    const result = await create({ directory })
    expect(result.written).toEqual(FILES)
    expect(result.kept).toEqual([])

    // The templates are checked against the schema and the link checker of the Shabd in this
    // repository, so they cannot drift from it unnoticed.
    const { problems, context } = await problemsOf(directory)
    expect(problems).toEqual([])
    expect(context.store.pages().map((page) => page.path).sort()).toEqual(['/', '/guide/getting-started', '/guide/writing'])
    expect(context.config.config.site.title).toBe('My docs')
    expect(context.config.config.theme.preset).toBe('shabd')
  })

  it('fills in the title and the preset, whatever characters the title has', async () => {
    const directory = path.join(scratch, 'awkward')
    const title = `Acme's "docs": v2 # {not a comment}`
    await create({ directory, title, preset: 'forest' })
    const { problems, context } = await problemsOf(directory)
    expect(problems).toEqual([])
    expect(context.config.config.site.title).toBe(title)
    expect(context.config.config.site.description).toBe(`Documentation for ${title}.`)
    expect(context.config.config.theme.preset).toBe('forest')
    expect(context.store.byPath('/')?.title).toBe(title)
  })

  it('takes the title from the directory name when none is given', () => {
    expect(titleFromDirectory('my-docs')).toBe('My docs')
    expect(titleFromDirectory('/tmp/acme_api.guide')).toBe('Acme api guide')
    expect(titleFromDirectory('.')).not.toBe('')
  })

  it('asks the new site for the Shabd in this repository and the packages it needs beside it', async () => {
    const shabd = JSON.parse(await readFile(path.join(here, '../../shabd/package.json'), 'utf8'))
    expect(SHABD_RANGE).toBe(`^${shabd.version}`)
    for (const [name, range] of Object.entries(PEERS)) expect(shabd.peerDependencies[name], name).toBe(range)
    // Every peer that is not optional is asked for.
    const required = Object.keys(shabd.peerDependencies).filter((name) => !shabd.peerDependenciesMeta?.[name]?.optional)
    expect(Object.keys(PEERS).sort()).toEqual(required.sort())

    const directory = path.join(scratch, 'local')
    await create({ directory, shabd: 'file:../shabd-0.1.0.tgz' })
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
    expect(manifest).toMatchObject({ name: 'local', private: true, type: 'module' })
    expect(manifest.dependencies).toEqual({ ...PEERS, shabd: 'file:../shabd-0.1.0.tgz' })
    expect(manifest.scripts).toEqual({ dev: 'shabd dev', build: 'shabd build', preview: 'shabd preview', check: 'shabd check' })
  })

  it('refuses a directory that is not empty, and with --force keeps what is there', async () => {
    const directory = path.join(scratch, 'taken')
    await mkdir(path.join(directory, '.git'), { recursive: true })
    // A fresh `git init` is not a reason to refuse.
    await create({ directory })

    await writeFile(path.join(directory, 'sidebar.yaml'), '# mine\n')
    await rm(path.join(directory, 'shabd.config.yaml'))
    await expect(create({ directory })).rejects.toThrow(/is not empty/)
    expect(existsSync(path.join(directory, 'shabd.config.yaml'))).toBe(false)

    const forced = await create({ directory, force: true })
    expect(forced.written).toEqual(['shabd.config.yaml'])
    expect(forced.kept).toEqual(FILES.filter((file) => file !== 'shabd.config.yaml'))
    expect(await readFile(path.join(directory, 'sidebar.yaml'), 'utf8')).toBe('# mine\n')
  })

  it('rejects a preset name that could not be one', async () => {
    await expect(create({ directory: path.join(scratch, 'bad'), preset: 'Forest: true' })).rejects.toThrow(/preset name/)
    expect(existsSync(path.join(scratch, 'bad'))).toBe(false)
  })

  it('reports what it did on the command line, with an exit code', async () => {
    const lines: string[] = []
    const errors: string[] = []
    const run = (...args: string[]) => main(args, (line: string) => lines.push(line), (line: string) => errors.push(line))
    const directory = path.join(scratch, 'cli')

    expect(await run('--help')).toBe(0)
    expect(lines.join('\n')).toContain('Usage: create-shabd [directory] [options]')

    lines.length = 0
    expect(await run(directory, '--title', 'From the CLI')).toBe(0)
    expect(lines.join('\n')).toContain('shabd.config.yaml')
    expect(lines.join('\n')).toContain('npm run dev')
    expect(await readFile(path.join(directory, 'shabd.config.yaml'), 'utf8')).toContain('title: "From the CLI"')

    expect(await run(directory)).toBe(1)
    expect(errors.join('\n')).toContain('is not empty')
    expect(await run('one', 'two')).toBe(1)
    expect(await run('--nonsense')).toBe(1)
  })

  it('runs as a program', () => {
    const directory = path.join(scratch, 'program')
    const done = spawnSync(process.execPath, [BIN, directory, '--preset', 'macos'], { encoding: 'utf8' })
    expect(done.status).toBe(0)
    expect(done.stdout).toContain('Created a Shabd site')
    const again = spawnSync(process.execPath, [BIN, directory], { encoding: 'utf8' })
    expect(again.status).toBe(1)
    expect(again.stderr).toContain('is not empty')
  })
})
