/** Real builds of small sites, for tests of what `shabd build` writes. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, vi } from 'vitest'
import { build, type BuildOptions } from '../../src/node/build/build.js'

/**
 * Inside the package, so that `react` and Shabd's browser code resolve from
 * the repository's node_modules. The folder is ignored by Git.
 */
const WORK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp')

/**
 * For a test site's config. Without it a build would find Transformers.js in
 * the repository and bundle its runtime, which a test of something else does
 * not need to wait for.
 */
export const KEYWORD_SEARCH = 'features:\n  search: { semantic: false }\n'

export interface BuiltSite {
  /** The site folder. The build is in `dist/` inside it. */
  dir: string
  /** The text of a file the build wrote, by its path inside `dist/`. */
  read(file: string): Promise<string>
  /** Whether the build wrote a file at this path inside `dist/`. */
  has(file: string): boolean
  /** What the build printed, without colours. */
  output: string
  /** Build the same folder again, as it is now, and give back what that build printed. */
  rebuild(): Promise<string>
}

/**
 * Call once in a test file. Returns a function that writes a site, builds it
 * and gives back what was built; every site is removed when the file's tests
 * are done.
 */
export function temporaryBuilds(): (files: Record<string, string>, options?: BuildOptions) => Promise<BuiltSite> {
  const dirs: string[] = []
  afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))))

  return async (files, options = {}) => {
    await mkdir(WORK, { recursive: true })
    const dir = await mkdtemp(path.join(WORK, 'build-'))
    dirs.push(dir)
    for (const [name, contents] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true })
      await writeFile(path.join(dir, name), contents)
    }

    /** Run the build with its output caught, and give the output back without colours. */
    const run = async (): Promise<string> => {
      const printed: string[] = []
      const log = vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        printed.push(parts.join(' '))
      })
      try {
        await build(dir, { semantic: false, ...options })
      } finally {
        log.mockRestore()
      }
      // eslint-disable-next-line no-control-regex
      return printed.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
    }

    const dist = path.join(dir, 'dist')
    return {
      dir,
      read: (file) => readFile(path.join(dist, file), 'utf8'),
      has: (file) => existsSync(path.join(dist, file)),
      output: await run(),
      rebuild: run,
    }
  }
}
