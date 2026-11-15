import { normalizeBadge, type BadgeVariant } from '../../shared/badge.js'

export interface BadgeProps {
  text?: string
  variant?: BadgeVariant
  children?: React.ReactNode
}

/** A small label. In MDX: `<Badge text="Beta" />`, or `<Badge variant="tip">Recommended</Badge>`. */
export function Badge({ text, variant, children }: BadgeProps) {
  const label = text ?? (typeof children === 'string' ? children : '')
  const resolved = variant ?? normalizeBadge(label).variant
  return (
    <span className="sb-badge" data-variant={resolved}>
      {text ?? children}
    </span>
  )
}
