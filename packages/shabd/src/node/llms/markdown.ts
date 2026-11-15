/**
 * A page as plain Markdown, for readers that are not browsers: llms-full.txt,
 * the per-page `.md` files, and the MCP `read_page` tool.
 *
 * The author's Markdown is kept as written. Only what a language model cannot
 * use is removed: the frontmatter block and MDX import/export statements.
 */
import type { PageRecord } from '../content/store.js'

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** Remove MDX `import`/`export` blocks. They run until the next blank line; code fences are left alone. */
export function stripEsm(body: string): string {
  const out: string[] = []
  let fence: string | null = null
  let inEsm = false

  for (const line of body.split(/\r?\n/)) {
    const marker = FENCE.exec(line)?.[1]
    if (marker && !inEsm) {
      if (fence === null) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (fence === null) {
      if (inEsm) {
        if (line.trim() === '') inEsm = false
        continue
      }
      if (/^(?:import|export)\s/.test(line)) {
        inEsm = true
        continue
      }
    }
    out.push(line)
  }
  return out.join('\n')
}

export function pageMarkdown(page: PageRecord): string {
  const body = (page.format === 'mdx' ? stripEsm(page.body) : page.body).trim()
  const parts: string[] = []
  // A page whose title came from frontmatter has no heading of its own in the body.
  if (!page.titleFromHeading) parts.push(`# ${page.title}`)
  if (page.description && !page.titleFromHeading) parts.push(`> ${page.description}`)
  parts.push(body)
  return `${parts.filter(Boolean).join('\n\n')}\n`
}
