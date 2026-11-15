/**
 * Per-file state shared by the pipeline's plugins.
 *
 * The unified processor is created once and reused for every page, so plugins
 * must not keep page state in closures. They read inputs from, and write
 * results to, this object on the VFile.
 */
import type { VFile } from 'vfile'
import type { PageSection, TocEntry } from '../../shared/types.js'

export interface PageData {
  /* inputs */
  /** Lift a leading `# heading` out of the body and report it as the title. */
  liftTitle: boolean
  /** Route path of the page, used to resolve relative links. Undefined for partials. */
  routePath: string | undefined
  /** Content-relative path of the file, used to resolve `./other.md` links. */
  id: string | undefined

  /* outputs */
  title: string | undefined
  toc: TocEntry[]
  sections: PageSection[]
  /** Internal links found in the page, as route paths (with `#hash` when present). */
  links: string[]
  /** Every heading id on the page, for checking `#fragment` links that point here. */
  anchors: string[]
}

const KEY = 'shabd'

export function initPageData(file: VFile, input: Pick<PageData, 'liftTitle' | 'routePath' | 'id'>): PageData {
  const data: PageData = { ...input, title: undefined, toc: [], sections: [], links: [], anchors: [] }
  file.data[KEY] = data
  return data
}

export function pageData(file: VFile): PageData {
  return (file.data[KEY] as PageData | undefined) ?? initPageData(file, { liftTitle: false, routePath: undefined, id: undefined })
}
