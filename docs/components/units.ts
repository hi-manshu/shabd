/**
 * Helpers that the live snippets of these docs may import. The config names
 * this file `docs/units` under `features.sandbox.modules`, and the page about
 * sandboxes has a snippet that imports it.
 */
const UNITS = ['bytes', 'KB', 'MB', 'GB']

/** A count of bytes as a reader would say it: 1536 is "1.5 KB". */
export function bytes(count: number): string {
  let value = count
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`
}
