import type { ReactNode } from 'react'
import { Icon } from '../app/icons.js'

/**
 * Content that stays folded away until the reader asks for it: an answer
 * under its question, detail most readers can skip.
 *
 *     <Accordion title="Does it work offline?">
 *       Yes, once the page has been opened.
 *     </Accordion>
 *
 * It is a `<details>` element, so it opens without JavaScript, the browser's
 * own find-in-page opens it when the match is inside, and its content is in
 * the page for search and for the Markdown copy whether it is open or not.
 */
export function Accordion({ title, open = false, children }: { title: string; open?: boolean; children?: ReactNode }) {
  return (
    <details className="sb-accordion" open={open}>
      <summary>
        <Icon name="chevron" size={14} />
        <span>{title}</span>
      </summary>
      <div className="sb-accordion-body">{children}</div>
    </details>
  )
}
