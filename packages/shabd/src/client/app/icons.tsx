/** A small, self-drawn icon set. Stroke icons inherit the text colour. */
import { ICONS, type IconName } from './icon-table.js'

export type { IconName }

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="sb-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  )
}
