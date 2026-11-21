/**
 * A theme's colours written into a config (src/node/config/theme-edit.ts):
 * the change is made, and every other character is as it was.
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { themeYaml, writeTheme } from '../src/node/config/theme-edit.js'
import { contrastReport, CONTRAST_FLOORS } from '../src/shared/theme-check.js'
import { contrast, THEME_PRESETS } from '../src/shared/presets.js'

/** The lines of `after` that `before` does not have, and the other way round. */
function difference(before: string, after: string): { added: string[]; removed: string[] } {
  const was = before.split('\n')
  const is = after.split('\n')
  return { added: is.filter((line) => !was.includes(line)), removed: was.filter((line) => !is.includes(line)) }
}

const CONFIG = [
  '# What the site is.',
  'site:',
  '  title: Docs',
  '',
  'theme:',
  '  # The site starts from this preset.',
  '  preset: paper',
  '  colors:',
  '    highlight: { light: "#f6b40e", dark: "#ffc53d" } # marigold',
  '    accent: "#2b36a8"',
  '',
  '# Laid out the way the person likes it.',
  'layouts:',
  '  wide:',
  '    regions:',
  '      banner: [notice]',
  '',
].join('\n')

describe('a theme written into the config', () => {
  it('replaces a colour where it stands, and leaves what is beside it', () => {
    const out = writeTheme(CONFIG, { colors: { highlight: { light: '#ff0000', dark: '#00ff00' }, accent: { light: '#111111', dark: '#eeeeee' } } })!
    expect(difference(CONFIG, out)).toEqual({
      added: ['    highlight: { light: "#ff0000", dark: "#00ff00" } # marigold', '    accent: { light: "#111111", dark: "#eeeeee" }'],
      removed: ['    highlight: { light: "#f6b40e", dark: "#ffc53d" } # marigold', '    accent: "#2b36a8"'],
    })
    // One value for both modes is written once.
    expect(writeTheme(CONFIG, { colors: { highlight: { light: '#abcdef', dark: '#abcdef' } } })).toContain('    highlight: "#abcdef" # marigold')
  })

  it('puts a colour that is not there on a line of its own, after the last of them', () => {
    const out = writeTheme(CONFIG, { colors: { muted: { light: '#555555', dark: '#aaaaaa' } } })!
    expect(difference(CONFIG, out)).toEqual({ added: ['    muted: { light: "#555555", dark: "#aaaaaa" }'], removed: [] })
    const lines = out.split('\n')
    expect(lines[lines.indexOf('    accent: "#2b36a8"') + 1]).toBe('    muted: { light: "#555555", dark: "#aaaaaa" }')
    expect(parse(out).theme.colors.muted).toEqual({ light: '#555555', dark: '#aaaaaa' })
  })

  it('changes the preset, and begins what is not there: the colours, or the theme itself', () => {
    expect(difference(CONFIG, writeTheme(CONFIG, { preset: 'nord' })!)).toEqual({ added: ['  preset: nord'], removed: ['  preset: paper'] })

    const plain = 'site:\n  title: Docs\ntheme:\n  preset: paper\nfeatures:\n  feed: true\n'
    expect(writeTheme(plain, { colors: { text: { light: '#000000', dark: '#ffffff' } } })).toBe(
      'site:\n  title: Docs\ntheme:\n  preset: paper\n  colors:\n    text: { light: "#000000", dark: "#ffffff" }\nfeatures:\n  feed: true\n',
    )
    // No theme at all, and no line ending after the last line.
    expect(writeTheme('site:\n  title: Docs', { preset: 'nord', colors: { text: { light: '#000', dark: '#fff' } } })).toBe(
      'site:\n  title: Docs\ntheme:\n  preset: nord\n  colors:\n    text: { light: "#000", dark: "#fff" }\n',
    )
  })

  it('follows the indent and the line endings the file has', () => {
    const wide = 'site:\r\n    title: Docs\r\ntheme:\r\n    colors:\r\n        accent: "#123456"\r\n'
    expect(writeTheme(wide, { colors: { muted: { light: '#555555', dark: '#555555' } } })).toBe(
      'site:\r\n    title: Docs\r\ntheme:\r\n    colors:\r\n        accent: "#123456"\r\n        muted: "#555555"\r\n',
    )
  })

  it('writes nothing where it would have to rewrite what is there', () => {
    // The colours on one line, a theme with nothing in it, and a file that is not a mapping.
    expect(writeTheme('site: { title: Docs }\ntheme:\n  colors: { accent: "#123456" }\n', { colors: { muted: { light: '#555', dark: '#555' } } })).toBeUndefined()
    expect(writeTheme('site:\n  title: Docs\ntheme:\n', { preset: 'nord' })).toBeUndefined()
    expect(writeTheme('- a list\n', { preset: 'nord' })).toBeUndefined()
    expect(writeTheme('site:\n  title: [unclosed\n', { preset: 'nord' })).toBeUndefined()
    // The lines to put in by hand say the same change.
    expect(themeYaml({ preset: 'nord', colors: { muted: { light: '#555', dark: '#555' }, text: { light: '#000', dark: '#fff' } } })).toBe(
      'theme:\n  preset: nord\n  colors:\n    muted: "#555"\n    text: { light: "#000", dark: "#fff" }\n',
    )
  })

  it('leaves the configs of this repository as they are but for the colour, comments and all', async () => {
    for (const file of ['../../../e2e/site/shabd.config.yaml', '../../../docs/shabd.config.yaml']) {
      const source = await readFile(new URL(file, import.meta.url), 'utf8')
      const out = writeTheme(source, { colors: { danger: { light: '#aa0000', dark: '#ff8888' } } })
      expect(out, file).toBeDefined()
      const { added, removed } = difference(source, out!)
      expect(removed, file).toEqual([])
      expect(added.filter((line) => line.trim() !== 'colors:'), file).toEqual([expect.stringMatching(/^ +danger: \{ light: "#aa0000", dark: "#ff8888" \}$/)])
      expect(parse(out!).theme.colors.danger, file).toEqual({ light: '#aa0000', dark: '#ff8888' })
    }
  })
})

describe('the contrast of a theme', () => {
  const light = (colours: Record<string, string>) => Object.fromEntries(Object.entries(colours).map(([token, value]) => [token, { light: value, dark: value }]))

  it('is measured for what is read against what it is read on, in both modes', () => {
    const lines = contrastReport(THEME_PRESETS.shabd.colors)
    // Each of the colours that is read, on the page and on a panel, in the two modes.
    expect(lines).toHaveLength(Object.keys(CONTRAST_FLOORS).length * 2 * 2)
    const text = lines.find((line) => line.ink === 'text' && line.on === 'background' && line.mode === 'light')!
    expect(text.floor).toBe(7)
    expect(text.ratio).toBeGreaterThan(7)
    // Every preset passes: the same floors a test holds them to.
    expect(lines.filter((line) => line.ratio !== undefined && line.ratio < line.floor)).toEqual([])
  })

  it('finds a colour too faint for what is behind it, and says by how much', () => {
    const lines = contrastReport({ ...THEME_PRESETS.shabd.colors, accent: { light: '#bbbbbb', dark: '#b3bbff' } })
    const faint = lines.filter((line) => line.ratio !== undefined && line.ratio < line.floor)
    expect(faint.map((line) => `${line.ink} on ${line.on}, ${line.mode}`)).toEqual(['accent on background, light', 'accent on surface, light'])
    expect(faint[0]!.ratio).toBeCloseTo(contrast('#bbbbbb', THEME_PRESETS.shabd.colors.background.light), 5)
  })

  it('measures the colours a site may add against what they are drawn on', () => {
    const base = light({ background: '#ffffff', surface: '#f0f0f0', text: '#111111', muted: '#555555', accent: '#1111aa', note: '#1111aa', tip: '#116611', success: '#116611', caution: '#774400', danger: '#aa1111' })
    const pairs = (extra: Record<string, string>) =>
      contrastReport({ ...base, ...light(extra) })
        // After the lines of the twelve, which are always there.
        .slice(Object.keys(CONTRAST_FLOORS).length * 2 * 2)
        .filter((line) => line.mode === 'light')
        .map((line) => `${line.ink} on ${line.on}: ${line.ratio === undefined ? 'not measured' : line.ratio.toFixed(1)}`)
    expect(pairs({})).toEqual([])
    // Worked out here the other way: by the function the presets are measured with.
    const ratio = (ink: string, on: string) => contrast(ink, on).toFixed(1)
    expect(pairs({ link: '#1111aa' })).toEqual([`link on background: ${ratio('#1111aa', '#ffffff')}`, `link on surface: ${ratio('#1111aa', '#f0f0f0')}`])
    // A header with ink of its own is read against the header, and a button's label against the button.
    expect(pairs({ header: '#000080', headerText: '#ffffff', button: '#000080' })).toEqual([
      `headerText on header: ${ratio('#ffffff', '#000080')}`,
      `background on button: ${ratio('#ffffff', '#000080')}`,
    ])
    // A header that is see-through is over the page: half navy over white is this colour.
    expect(pairs({ header: 'rgb(0 0 128 / 0.5)' })).toEqual([`text on header: ${ratio('#111111', '#8080c0')}`])
    // What is not a colour that can be read here is said to be not measured, and is not called a fault.
    expect(pairs({ link: 'oklch(0.5 0.2 260)' })).toEqual(['link on background: not measured', 'link on surface: not measured'])
  })
})
