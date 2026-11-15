import type { ReactNode } from 'react'

const TITLES = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
} as const

export type CalloutType = keyof typeof TITLES

/**
 * A highlighted aside. Written in Markdown as a GitHub alert:
 *
 *     > [!WARNING] Optional title
 *     > Body.
 *
 * or in MDX as `<Callout type="warning" title="…">`.
 */
export function Callout({ type = 'note', title, children }: { type?: CalloutType; title?: string; children?: ReactNode }) {
  const kind = type in TITLES ? type : 'note'
  return (
    <aside className="sb-callout" data-type={kind} role="note">
      <p className="sb-callout-title">{title ?? TITLES[kind]}</p>
      <div className="sb-callout-body">{children}</div>
    </aside>
  )
}
