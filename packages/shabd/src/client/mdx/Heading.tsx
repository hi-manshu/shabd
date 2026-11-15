import type { ComponentProps } from 'react'
import { Icon } from '../app/icons.js'

type Level = 1 | 2 | 3 | 4 | 5 | 6

/** A heading with a link to itself. The id is assigned at compile time (rehype-headings). */
export function heading(level: Level) {
  const Tag = `h${level}` as const
  function Heading({ id, children, ...rest }: ComponentProps<'h2'>) {
    return (
      <Tag id={id} {...rest}>
        {children}
        {id && (
          <a className="sb-anchor" href={`#${id}`} aria-label="Link to this section">
            <Icon name="hash" size={16} />
          </a>
        )}
      </Tag>
    )
  }
  Heading.displayName = `Heading${level}`
  return Heading
}
