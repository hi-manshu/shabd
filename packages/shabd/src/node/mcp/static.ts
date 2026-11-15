/** A DocsSource over the files a build wrote. Needs no content folder and no embedding model. */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { SearchIndexFile } from '../../shared/search-core.js'
import { DOCS_FILE, SEARCH_INDEX_FILE, staticDocsFrom, type DocsFile, type DocsSource } from './source.js'

/** Load the docs a build wrote into `distDir`. */
export async function staticDocs(distDir: string): Promise<DocsSource> {
  const docs = JSON.parse(await readFile(path.join(distDir, DOCS_FILE), 'utf8')) as DocsFile
  const searchIndex = await readFile(path.join(distDir, SEARCH_INDEX_FILE), 'utf8')
    .then((text) => JSON.parse(text) as SearchIndexFile)
    .catch(() => null)
  return staticDocsFrom(docs, searchIndex)
}
