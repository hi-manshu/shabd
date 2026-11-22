import type { ReactNode } from 'react'

/**
 * A procedure. Wrap an ordered list, and each item becomes a step with its
 * number beside it and a line down to the next.
 *
 *     <Steps>
 *
 *     1. Install it.
 *     2. Run it.
 *
 *     </Steps>
 *
 * The list stays a list: the numbers are drawn by the stylesheet, so the
 * page reads the same to a screen reader, in the Markdown copy and on paper.
 */
export function Steps({ children }: { children?: ReactNode }) {
  return <div className="sb-steps">{children}</div>
}
