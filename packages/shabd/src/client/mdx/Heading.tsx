import type { ComponentProps } from 'react'
import { useText } from '../app/edition.js'
import { Icon } from '../app/icons.js'

type Level = 1 | 2 | 3 | 4 | 5 | 6

/** A heading with a link to itself. The id is assigned at compile time (rehype-headings). */
export function heading(level: Level) {
  const Tag = `h${level}` as const
  function Heading({ id, children, ...rest }: ComponentProps<'h2'>) {
    const text = useText()
    return (
      <Tag id={id} {...rest}>
        {children}
        {id && (
          <a className="sb-anchor" href={`#${id}`} aria-label={text('heading.link')}>
            <Icon name="hash" size={16} />
          </a>
        )}
      </Tag>
    )
  }
  Heading.displayName = `Heading${level}`
  return Heading
}
