/**
 * Frontmatter: the YAML block at the top of a page that selects its layout
 * and switches regions on and off.
 */
import { FrontmatterSchema, type Frontmatter } from '../../shared/schema.js'
import { closestMatch, ShabdError } from '../config/errors.js'
import { parseYaml, toSourceIssues } from '../config/yaml.js'

const OPENING = /^\uFEFF?---[ \t]*\r?\n/
const CLOSING = /^---[ \t]*\r?$/gm

export interface FrontmatterBlock {
  /** The source up to (not including) the closing `---`. Starts with the opening `---`. */
  yaml: string
  /** Everything after the closing `---` line. */
  body: string
}

/** Split a page into its frontmatter block and body. Returns null when there is no frontmatter. */
export function splitFrontmatter(source: string): FrontmatterBlock | null {
  const opening = OPENING.exec(source)
  if (!opening) return null
  CLOSING.lastIndex = opening[0].length
  const closing = CLOSING.exec(source)
  if (!closing) return null
  const afterClosing = closing.index + closing[0].length
  return {
    yaml: source.slice(0, closing.index),
    body: source.slice(afterClosing).replace(/^\r?\n/, ''),
  }
}

export interface ParsedPage {
  frontmatter: Frontmatter
  body: string
}

/**
 * Parse and validate a page's frontmatter.
 *
 * The YAML is parsed in place (the leading `---` is a valid document marker),
 * so reported line numbers are line numbers in the page file.
 */
export function parseFrontmatter(file: string, source: string, knownLayouts: string[]): ParsedPage {
  const block = splitFrontmatter(source)
  const yaml = block ? parseYaml(file, block.yaml) : undefined
  const data = yaml?.data ?? {}

  const result = FrontmatterSchema.safeParse(data, { reportInput: true })
  if (!result.success) {
    const locate = yaml ?? { data, locate: () => undefined }
    throw new ShabdError(file, toSourceIssues(result.error.issues, locate, FrontmatterSchema), source)
  }

  const frontmatter = result.data
  if (frontmatter.layout !== undefined && !knownLayouts.includes(frontmatter.layout)) {
    const suggestion = closestMatch(frontmatter.layout, knownLayouts)
    throw new ShabdError(
      file,
      [
        {
          path: ['layout'],
          message:
            `Layout "${frontmatter.layout}" does not exist.` +
            (suggestion ? ` Did you mean "${suggestion}"?` : '') +
            ` Available layouts: ${[...knownLayouts].sort().join(', ')}`,
          ...yaml?.locate(['layout']),
        },
      ],
      source,
    )
  }

  return { frontmatter, body: block ? block.body : source }
}

/**
 * The text of a `# Heading` that opens the body, if there is one.
 *
 * Plain Markdown files usually carry their title this way. When frontmatter
 * has no `title`, this heading becomes the page title (and the pipeline lifts
 * it out of the body so it is not rendered twice).
 */
export function leadingHeading(body: string, format: 'md' | 'mdx'): string | undefined {
  const lines = body.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      i++
      continue
    }
    // An MDX import/export block runs until the next blank line.
    if (format === 'mdx' && /^(?:import|export)\s/.test(line)) {
      while (i < lines.length && lines[i]!.trim() !== '') i++
      continue
    }
    const heading = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line)
    return heading ? stripInlineMarkdown(heading[1]!) : undefined
  }
  return undefined
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim()
}
