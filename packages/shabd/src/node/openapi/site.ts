/**
 * The pages of a site's OpenAPI descriptions, as files.
 *
 * `openapi:` in the config names a description and the address its pages go
 * at. The pages are written, as the Markdown files they are, into a folder
 * of the site that is laid out like the content folder: the pages of an API
 * at `/api` are in `api/`. From there they are pages like any other. The
 * content store reads them, the dev server compiles and watches them, and a
 * build writes them out.
 *
 * Files, and not pages held in memory, because everything that handles a
 * page handles a file: the route table imports it, the compile cache is
 * keyed by it, Vite sends its changes to the browser.
 *
 * The folder is `.shabd/openapi` in the site folder, whether or not the rest
 * of the cache is under `node_modules`. A module under `node_modules` is a
 * dependency to Vite, and what a dependency imports is not prepared for the
 * browser: a page there would bring React in a second time, as it is
 * published, and not load.
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ResolvedConfig } from '../config/load.js'
import { generateApiPages, readOpenApi } from './index.js'

/** One description's pages, as the site holds them. */
export interface ApiSection {
  /** The description's file. */
  spec: string
  /** The folder of its pages, as a slug: `api` for an API at `/api`, and empty for one at `/`. */
  dir: string
  /** `info.title` of the description: what the API is called in the sidebar. */
  title: string
  /** Its operations by tag, as the slugs of their pages on the site, in the description's order. */
  groups: { label: string; slugs: string[] }[]
  /** What of the description could not be shown. */
  notes: string[]
}

export interface WrittenApis {
  sections: ApiSection[]
  /** Every page file there is now, as an absolute path. */
  files: string[]
  /** What this writing changed on disk. A file whose text is the same is not written, and is in none of the three. */
  added: string[]
  changed: string[]
  removed: string[]
}

const toPosix = (file: string) => file.split(path.sep).join('/')

/** Every Markdown file under a folder, as absolute paths. A folder that is not there holds none. */
async function pagesIn(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => path.join(entry.parentPath, entry.name))
}

/**
 * Read every description the config names, and bring the folder of their
 * pages up to date: a page whose text changed is written, one that is no
 * longer made is removed, and the rest are left alone, so that nothing
 * downstream takes an unchanged page for a changed one.
 *
 * Throws the ShabdError of a description that cannot be read or is not
 * OpenAPI 3. Nothing is written or removed for any description then.
 */
export async function writeApiPages(config: ResolvedConfig): Promise<WrittenApis> {
  const root = config.generatedDir
  const wanted = new Map<string, string>()
  const sections: ApiSection[] = []

  for (const api of config.openapi) {
    const generated = generateApiPages(await readOpenApi(api.spec), { tryIt: api.try })
    const dir = api.prefix.replace(/^\/+/, '')
    const slugOf = (slug: string) => (dir ? `${dir}/${slug}` : slug)
    // A page says in its own frontmatter that there is no file of it to edit (`editLink: false`).
    for (const page of generated.pages) wanted.set(`${path.join(root, ...slugOf(page.slug).split('/'))}.md`, page.source)
    sections.push({
      spec: api.spec,
      dir,
      title: generated.title,
      groups: generated.groups.map((group) => ({ label: group.label, slugs: group.slugs.map(slugOf) })),
      notes: generated.notes,
    })
  }

  const written: WrittenApis = { sections, files: [...wanted.keys()], added: [], changed: [], removed: [] }
  for (const [file, text] of wanted) {
    const before = existsSync(file) ? await readFile(file, 'utf8') : undefined
    if (before === text) continue
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, text)
    written[before === undefined ? 'added' : 'changed'].push(file)
  }
  for (const file of await pagesIn(root)) {
    if (wanted.has(file)) continue
    await rm(file, { force: true })
    written.removed.push(file)
  }
  return written
}

/** The id a generated page has in the content store: its path under the folder, as if that were the content folder. */
export function generatedId(config: ResolvedConfig, file: string): string | undefined {
  const relative = path.relative(config.generatedDir, file)
  return relative.startsWith('..') || path.isAbsolute(relative) ? undefined : toPosix(relative)
}
