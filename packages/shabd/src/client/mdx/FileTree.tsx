import type { ReactNode } from 'react'

/**
 * A folder and what is in it. Wrap a list: an item with a list inside it is
 * a folder, anything else is a file.
 *
 *     <FileTree>
 *
 *     - shabd.config.yaml
 *     - content/
 *       - index.md
 *       - **guide.md** *the page this is about*
 *
 *     </FileTree>
 *
 * Bold marks the entry the text is talking about, and italics are a note
 * beside a name. Which icon an entry gets is decided by the stylesheet, from
 * the shape of the list, so the Markdown stays an ordinary list.
 */
export function FileTree({ children }: { children?: ReactNode }) {
  return <div className="sb-file-tree">{children}</div>
}
