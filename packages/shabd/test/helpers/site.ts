/** Sites written to a temporary folder, for tests that need real files. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { isShabdError, type ShabdError } from '../../src/node/config/errors.js'

/**
 * Call once in a test file. Returns a function that writes a site and gives
 * back its folder; every site is removed when the file's tests are done.
 */
export function temporarySites(): (files: Record<string, string>) => Promise<string> {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'shabd-test-'))
  })
  afterAll(() => rm(root, { recursive: true, force: true }))

  return async (files) => {
    const dir = await mkdtemp(path.join(root, 'site-'))
    for (const [name, contents] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true })
      await writeFile(path.join(dir, name), contents)
    }
    return dir
  }
}

/** The ShabdError that `run` throws. Anything else it throws, or nothing, fails the test. */
export function failure(run: () => unknown): ShabdError {
  try {
    run()
  } catch (error) {
    if (isShabdError(error)) return error
    throw error
  }
  throw new Error('expected a ShabdError')
}
