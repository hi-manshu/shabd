/**
 * Per-file state shared by the pipeline's plugins.
 *
 * The unified processor is created once and reused for every page, so plugins
 * must not keep page state in closures. They read inputs from, and write
 * results to, this object on the VFile.
 */
import type { VFile } from 'vfile'
import type { PageSection, TocEntry } from '../../shared/types.js'

/** Something in a page, and the line it is written on when that is known. */
export interface Located {
  line?: number
}

export interface PageData {
  /* inputs */
  /** Lift a leading `# heading` out of the body and report it as the title. */
  liftTitle: boolean
  /** Route path of the page, used to resolve relative links. Undefined for partials. */
  routePath: string | undefined
  /** Content-relative path of the file, used to resolve `./other.md` links. */
  id: string | undefined
  /** Set the page's code beside its prose, row by row. The page's layout asks for it. */
  split?: boolean | undefined

  /* outputs */
  title: string | undefined
  toc: TocEntry[]
  sections: PageSection[]
  /** Internal links found in the page, as route paths (with `#hash` when present). */
  links: string[]
  /** The line each of `links` is written on, in the same order. Zero where it is not known. */
  linkLines: number[]
  /** Links to other sites, for `shabd check --external`. */
  external: ({ url: string } & Located)[]
  /** Pictures with no alternative text. */
  unlabelled: ({ src: string } & Located)[]
  /** Tags in a `.md` page that are written like components, which only work in `.mdx`. */
  strays: ({ name: string } & Located)[]
  /** The live snippets of the page as they are written, each with the line its fence opens on. */
  snippets: ({ code: string } & Located)[]
  /** The colours of the page's code tokens in the site's own two syntax themes, as a stylesheet. Empty when the page has no highlighted code. */
  codeCss: string
  /** Each token class of the page with its colour under every syntax theme the theme menu can reach. Empty without a menu. */
  codeColours: Record<string, string[]>
  /** Every heading id on the page, for checking `#fragment` links that point here. */
  anchors: string[]
}

const KEY = 'shabd'

export function initPageData(file: VFile, input: Pick<PageData, 'liftTitle' | 'routePath' | 'id' | 'split'>): PageData {
  const data: PageData = {
    ...input,
    title: undefined,
    toc: [],
    sections: [],
    links: [],
    linkLines: [],
    external: [],
    unlabelled: [],
    strays: [],
    snippets: [],
    anchors: [],
    codeCss: '',
    codeColours: {},
  }
  file.data[KEY] = data
  return data
}

export function pageData(file: VFile): PageData {
  return (file.data[KEY] as PageData | undefined) ?? initPageData(file, { liftTitle: false, routePath: undefined, id: undefined })
}
