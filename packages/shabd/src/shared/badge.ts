/** Badges: small labels on pages and sidebar entries. Free of Zod so the browser can import it. */

export const BADGE_VARIANTS = ['default', 'note', 'tip', 'success', 'caution', 'danger'] as const
export type BadgeVariant = (typeof BADGE_VARIANTS)[number]

export interface Badge {
  text: string
  variant: BadgeVariant
}

export type BadgeLike = string | { text: string; variant?: BadgeVariant | undefined }

/** `badge: New` picks a sensible colour without the author naming a variant. */
const WELL_KNOWN_BADGES: Record<string, BadgeVariant> = {
  new: 'success',
  stable: 'success',
  beta: 'caution',
  alpha: 'caution',
  experimental: 'caution',
  preview: 'note',
  deprecated: 'danger',
}

export function normalizeBadge(input: BadgeLike): Badge {
  const text = typeof input === 'string' ? input : input.text
  const explicit = typeof input === 'string' ? undefined : input.variant
  return { text, variant: explicit ?? WELL_KNOWN_BADGES[text.trim().toLowerCase()] ?? 'default' }
}
