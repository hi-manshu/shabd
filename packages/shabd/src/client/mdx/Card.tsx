import type { ReactNode } from 'react'
import { Link } from '../ui/Link.js'

/** A titled block of content, optionally a link. Group several with <CardGrid>. */
export function Card({ title, href, children }: { title: string; href?: string; children?: ReactNode }) {
  const body = (
    <>
      <p className="sb-card-title">{title}</p>
      <div className="sb-card-body">{children}</div>
    </>
  )
  return href ? (
    <Link className="sb-card" href={href}>
      {body}
    </Link>
  ) : (
    <div className="sb-card">{body}</div>
  )
}

export function CardGrid({ children }: { children?: ReactNode }) {
  return <div className="sb-card-grid">{children}</div>
}
