/**
 * The little colour arithmetic Shabd needs: reading a colour, laying one over
 * another, measuring contrast, and moving a colour's lightness until it has
 * enough of it.
 *
 * Only what can be read without a browser is understood: hex colours and
 * `rgb()`. Anything else (`oklch()`, a named colour, a variable) reads as
 * unknown, and callers leave such a colour alone.
 */

/** Red, green and blue from 0 to 255, and alpha from 0 to 1. */
export type Rgba = [red: number, green: number, blue: number, alpha: number]

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB = /^rgba?\(\s*([^)]+)\)$/i

/** Read `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` or `rgb()`. Undefined for anything else. */
export function parseColor(value: string): Rgba | undefined {
  const text = value.trim()
  const hex = HEX.exec(text)?.[1]
  if (hex) {
    const digits = hex.length <= 4 ? [...hex].map((digit) => digit + digit) : (hex.match(/../g) as string[])
    const [red, green, blue, alpha = 255] = digits.map((pair) => Number.parseInt(pair, 16)) as [number, number, number, number?]
    return [red, green, blue, alpha / 255]
  }
  const parts = RGB.exec(text)?.[1]?.split(/[\s,/]+/).filter(Boolean)
  if (!parts || parts.length < 3 || parts.length > 4) return undefined
  const channel = (part: string) => (part.endsWith('%') ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part))
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3])
  const colour: Rgba = [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!), alpha]
  return colour.every(Number.isFinite) ? colour : undefined
}

/** `#rrggbb`. Alpha is dropped: lay the colour over its background first. */
export function toHex([red, green, blue]: Rgba): string {
  const pair = (channel: number) => Math.min(255, Math.max(0, Math.round(channel))).toString(16).padStart(2, '0')
  return `#${pair(red)}${pair(green)}${pair(blue)}`
}

/** What you see when `top` is drawn over an opaque `under`. */
export function over(top: Rgba, under: Rgba): Rgba {
  const mix = (index: 0 | 1 | 2) => top[index] * top[3] + under[index] * (1 - top[3])
  return [mix(0), mix(1), mix(2), 1]
}

/** Relative luminance, as WCAG 2 defines it. */
export function luminanceOf([red, green, blue]: Rgba): number {
  const linear = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

/** WCAG 2 contrast ratio of a colour drawn on an opaque background, from 1 to 21. */
export function contrastOn(colour: Rgba, background: Rgba): number {
  const [lighter, darker] = [luminanceOf(over(colour, background)), luminanceOf(background)].sort((a, b) => b - a) as [
    number,
    number,
  ]
  return (lighter + 0.05) / (darker + 0.05)
}

function toHsl([red, green, blue]: Rgba): [hue: number, saturation: number, lightness: number] {
  const [r, g, b] = [red / 255, green / 255, blue / 255]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const spread = max - min
  const saturation = spread / (1 - Math.abs(2 * lightness - 1))
  const hue = max === r ? ((g - b) / spread + 6) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4
  return [hue * 60, saturation, lightness]
}

function fromHsl(hue: number, saturation: number, lightness: number): Rgba {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12
    return 255 * (lightness - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
  }
  return [channel(0), channel(8), channel(4), 1]
}

/**
 * The colour, or the nearest one of the same hue that has at least `floor`
 * contrast against every one of `backgrounds`.
 *
 * A colour that already has it comes back exactly as it was written. One that
 * does not is made darker on light backgrounds and lighter on dark ones, by
 * the smallest step that reaches the floor, keeping its hue and saturation.
 * Where no lightness reaches it (a high floor on a mid-grey background), the
 * result is black or white. A colour or background that cannot be read is
 * left alone.
 */
export function ensureContrast(colour: string, backgrounds: readonly string[], floor: number): string {
  if (floor <= 1) return colour
  const written = parseColor(colour)
  const behind = backgrounds.map(parseColor).filter((background): background is Rgba => background?.[3] === 1)
  if (!written || behind.length === 0) return colour
  const lowest = (candidate: Rgba) => Math.min(...behind.map((background) => contrastOn(candidate, background)))
  if (lowest(written) >= floor) return colour

  // A translucent token is taken as it looks on the first background. The result is opaque.
  const [hue, saturation, lightness] = toHsl(over(written, behind[0]!))
  const end = luminanceOf(behind[0]!) > 0.179 ? 0 : 1 // away from the background: 0.179 is where black and white tie
  const at = (step: number) => fromHsl(hue, saturation, lightness + (end - lightness) * step)
  // The hex written out is rounded, so it is the rounded colour that has to pass.
  const passes = (step: number) => lowest(parseColor(toHex(at(step)))!) >= floor
  if (!passes(1)) return toHex(at(1))

  let [short, enough] = [0, 1]
  for (let round = 0; round < 20; round++) {
    const middle = (short + enough) / 2
    if (passes(middle)) enough = middle
    else short = middle
  }
  return toHex(at(enough))
}
