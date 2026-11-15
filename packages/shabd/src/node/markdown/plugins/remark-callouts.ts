/**
 * GitHub-style alerts → <Callout> components.
 *
 *   > [!NOTE]
 *   > Useful information.
 *
 *   > [!WARNING] Custom title
 *   > Body.
 *
 * The blockquote keeps its children; only the marker line is consumed. The
 * node is renamed to `Callout`, which MDX resolves from the component map,
 * so a site can replace the component without touching this plugin.
 */
import type { Blockquote, Root } from 'mdast'
import { visit } from 'unist-util-visit'

export const CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type CalloutType = (typeof CALLOUT_TYPES)[number]

/** GitHub's five names, plus the synonyms people reach for. */
const ALIASES: Record<string, CalloutType> = {
  note: 'note',
  info: 'note',
  tip: 'tip',
  hint: 'tip',
  success: 'tip',
  important: 'important',
  warning: 'warning',
  caution: 'caution',
  danger: 'caution',
}

const MARKER = /^\[!([A-Za-z]+)\][ \t]*([^\n]*)(?:\n|$)/

export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, 'blockquote', (node: Blockquote) => {
      const paragraph = node.children[0]
      if (paragraph?.type !== 'paragraph') return
      const lead = paragraph.children[0]
      if (lead?.type !== 'text') return

      const marker = MARKER.exec(lead.value)
      const type = marker ? ALIASES[marker[1]!.toLowerCase()] : undefined
      if (!marker || !type) return

      const title = marker[2]!.trim()
      lead.value = lead.value.slice(marker[0].length)
      if (lead.value === '') {
        paragraph.children.shift()
        if (paragraph.children[0]?.type === 'break') paragraph.children.shift()
      }
      if (paragraph.children.length === 0) node.children.shift()

      node.data = {
        ...node.data,
        hName: 'Callout',
        hProperties: title ? { type, title } : { type },
      } as Blockquote['data']
    })
  }
}
