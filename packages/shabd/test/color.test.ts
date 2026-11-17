import { describe, expect, it } from 'vitest'
import { contrastOn, ensureContrast, over, parseColor, toHex, type Rgba } from '../src/shared/color.js'

const read = (colour: string) => parseColor(colour) as Rgba
const ratio = (colour: string, background: string) => contrastOn(read(colour), read(background))

describe('reading colours', () => {
  it('reads hex in every length, and rgb() in both spellings', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1])
    expect(parseColor('#1B1c3a')).toEqual([27, 28, 58, 1])
    expect(parseColor('#00000080')?.[3]).toBeCloseTo(0.5, 2)
    expect(parseColor('#f008')).toEqual([255, 0, 0, 136 / 255])
    expect(parseColor('rgb(244 247 251 / 0.58)')).toEqual([244, 247, 251, 0.58])
    expect(parseColor('rgba(12, 35, 64, 50%)')).toEqual([12, 35, 64, 0.5])
    expect(parseColor(' rgb(1, 2, 3) ')).toEqual([1, 2, 3, 1])
  })

  it('does not guess at what it cannot read', () => {
    for (const colour of ['oklch(60% 0.1 200)', 'rebeccapurple', 'var(--sb-text)', '#12345', 'rgb(1 2)', '']) {
      expect(parseColor(colour), colour).toBeUndefined()
    }
  })

  it('lays a translucent colour over an opaque one', () => {
    expect(toHex(over(read('#00000080'), read('#ffffff')))).toBe('#7f7f7f')
    expect(toHex(over(read('#123456'), read('#ffffff')))).toBe('#123456')
  })

  it('measures contrast as WCAG does, after laying the colour over its background', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(ratio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    // Black at half strength on white is a mid grey, not black.
    expect(ratio('#00000080', '#ffffff')).toBeCloseTo(ratio('#7f7f7f', '#ffffff'), 5)
  })
})

describe('ensureContrast', () => {
  it('returns a colour that already has enough contrast exactly as it was written', () => {
    expect(ensureContrast('#D73A49', ['#ffffff'], 4.5)).toBe('#D73A49')
    expect(ensureContrast('#dfa000', ['#eef4ea'], 0)).toBe('#dfa000')
  })

  it('darkens a faint colour on a light background by no more than it has to', () => {
    // Everforest's yellow on the Forest preset's code background: 2.05:1 as shipped.
    expect(ratio('#dfa000', '#eef4ea')).toBeLessThan(2.1)
    const fixed = ensureContrast('#dfa000', ['#eef4ea'], 4.5)
    expect(ratio(fixed, '#eef4ea')).toBeGreaterThanOrEqual(4.5)
    expect(ratio(fixed, '#eef4ea')).toBeLessThan(4.6)
    // Still a yellow: red above green, no blue.
    const [red, green, blue] = read(fixed)
    expect(red).toBeGreaterThan(green)
    expect(blue).toBe(0)
  })

  it('lightens a faint colour on a dark background', () => {
    // Vitesse Black's punctuation on the Terminal preset's code background: 1.91:1 as shipped.
    const fixed = ensureContrast('#444444', ['#0d150e'], 4.5)
    expect(ratio(fixed, '#0d150e')).toBeGreaterThanOrEqual(4.5)
    expect(ratio(fixed, '#0d150e')).toBeLessThan(4.6)
    const [red, green, blue] = read(fixed)
    expect(red).toBe(green)
    expect(green).toBe(blue)
  })

  it('satisfies every background it is given', () => {
    const backgrounds = ['#ffffff', '#e6edf6', '#f3f4fa']
    const fixed = ensureContrast('#e36209', backgrounds, 4.5)
    for (const background of backgrounds) expect(ratio(fixed, background), background).toBeGreaterThanOrEqual(4.5)
    // The darkest of them decides, so on white there is some to spare.
    expect(ratio(fixed, '#e6edf6')).toBeLessThan(4.6)
  })

  it('takes a translucent colour as it looks on the background', () => {
    const fixed = ensureContrast('#6a737d80', ['#ffffff'], 4.5)
    expect(fixed).toMatch(/^#[0-9a-f]{6}$/)
    expect(ratio(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('ends at black or white when no lightness reaches the floor', () => {
    expect(ensureContrast('#808080', ['#777777'], 7)).toBe('#000000')
    expect(ensureContrast('#808080', ['#222222'], 21)).toBe('#ffffff')
  })

  it('leaves alone what it cannot read', () => {
    expect(ensureContrast('var(--x)', ['#ffffff'], 4.5)).toBe('var(--x)')
    expect(ensureContrast('#dfa000', ['oklch(98% 0.01 150)'], 4.5)).toBe('#dfa000')
    expect(ensureContrast('#dfa000', [], 4.5)).toBe('#dfa000')
    // A translucent background says nothing about what is seen through it.
    expect(ensureContrast('#dfa000', ['rgb(255 255 255 / 0.5)'], 4.5)).toBe('#dfa000')
  })
})
