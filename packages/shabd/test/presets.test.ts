import { bundledThemes } from 'shiki'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/node/config/load.js'
import { MarkdownCompiler } from '../src/node/markdown/compile.js'
import { themedCodeCss } from '../src/node/markdown/plugins/rehype-code.js'
import { readFileSync } from 'node:fs'
import { contrastOn, over, parseColor, toHex, type Rgba } from '../src/shared/color.js'
import {
  BADGE_LABEL,
  BADGE_TINT,
  COLOR_TOKENS,
  LINE_HIGHLIGHT_STRENGTH,
  PRESET_NAMES,
  THEME_PRESETS,
  codeBackgrounds,
  codeThemePlan,
  contrast,
  type ColorToken,
} from '../src/shared/presets.js'
import { CONTRAST_FLOORS } from '../src/shared/theme-check.js'
import { renderCompiled } from './helpers/render.js'

const MODES = ['light', 'dark'] as const

/** What a colour is read against, and how much contrast that takes: the same floors the Studio shows a theme against. */
const FLOORS: Partial<Record<ColorToken, number>> = CONTRAST_FLOORS

describe('theme presets', () => {
  it('measures contrast as WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#ffffff', '#ffffff')).toBe(1)
    // The grey that sits exactly on the 4.5:1 line against white.
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
  })

  it.each(PRESET_NAMES)('%s defines every colour in both modes', (name) => {
    const preset = THEME_PRESETS[name]
    expect(preset.label).not.toBe('')
    expect(preset.description).not.toBe('')
    expect(Object.keys(preset.colors).sort()).toEqual([...COLOR_TOKENS].sort())
    for (const token of COLOR_TOKENS) {
      for (const mode of MODES) expect(preset.colors[token][mode], `${token} ${mode}`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it.each(PRESET_NAMES)('%s is readable: text, links and callouts against the page and the surface', (name) => {
    const { colors } = THEME_PRESETS[name]
    const misses: string[] = []
    for (const mode of MODES) {
      for (const [token, floor] of Object.entries(FLOORS) as [ColorToken, number][]) {
        for (const under of ['background', 'surface'] as const) {
          const ratio = contrast(colors[token][mode], colors[under][mode])
          if (ratio < floor) misses.push(`${mode} ${token} on ${under}: ${ratio.toFixed(2)} < ${floor}`)
        }
      }
    }
    expect(misses).toEqual([])
  })

  it('draws the editor in those colours and no others, so that it is readable wherever the page is', () => {
    const theme = readFileSync(new URL('../src/client/editor/theme.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    // No colour of its own.
    expect(theme).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color|color-mix)\(/i)
    const used = new Set([...theme.matchAll(/var\(--sb-([a-z-]+)\)/g)].map((match) => match[1]!))
    // The one that is a length.
    expect(used.delete('editor-padding')).toBe(true)
    expect([...used].sort()).toEqual(Object.keys(FLOORS).sort())
  })

  it.each(PRESET_NAMES)('%s names code themes that Shiki ships', (name) => {
    const { code } = THEME_PRESETS[name]
    expect(Object.keys(bundledThemes)).toEqual(expect.arrayContaining([code.light, code.dark]))
  })

  it('gives every preset its own label', () => {
    const labels = PRESET_NAMES.map((name) => THEME_PRESETS[name].label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

const themeOf = (yaml: string) =>
  resolveConfig('/site', '/site/shabd.config.yaml', `site: { title: Docs }\ntheme:\n${yaml}`).config.theme

/** A highlighted line's background: the palette's `highlight`, at the strength the stylesheet uses, over the code background. */
const tinted = (highlight: string, background: string) => {
  const [red, green, blue] = parseColor(highlight) as Rgba
  return toHex(over([red, green, blue, LINE_HIGHLIGHT_STRENGTH], parseColor(background) as Rgba))
}

describe('a badge', () => {
  /** The word of a badge and the tint under it, for a badge of this colour drawn on this background. */
  const badge = (colour: Rgba, text: Rgba, behind: Rgba) => ({
    label: over([colour[0], colour[1], colour[2], BADGE_LABEL], text),
    tint: over([colour[0], colour[1], colour[2], BADGE_TINT], behind),
  })

  it('is drawn by the stylesheet with the numbers that are checked here', () => {
    const css = readFileSync(new URL('../src/client/styles/base.css', import.meta.url), 'utf8')
    expect(css).toContain(`--sb-badge-label: color-mix(in srgb, var(--sb-badge-color, var(--sb-muted)) ${BADGE_LABEL * 100}%, var(--sb-text));`)
    expect(css).toContain(`background: color-mix(in srgb, var(--sb-badge-color, var(--sb-muted)) ${BADGE_TINT * 100}%, transparent);`)
  })

  it('can be read in every preset and every colour a badge has, on the page and on a surface', () => {
    const misses: string[] = []
    let plain = 0
    for (const name of PRESET_NAMES) {
      const { colors } = THEME_PRESETS[name]
      for (const mode of MODES) {
        const text = parseColor(colors.text[mode]) as Rgba
        for (const ink of ['muted', 'note', 'tip', 'success', 'caution', 'danger'] as const) {
          const colour = parseColor(colors[ink][mode]) as Rgba
          for (const where of ['background', 'surface'] as const) {
            const { label, tint } = badge(colour, text, parseColor(colors[where][mode]) as Rgba)
            const ratio = contrastOn(label, tint)
            if (ratio < 4.5) misses.push(`${name} ${mode}: ${ink} on ${where} is ${ratio.toFixed(2)}`)
            // The same badge with the word in its own colour, as it was drawn before.
            if (contrastOn(colour, tint) < 4.5) plain++
          }
        }
      }
    }
    expect(misses).toEqual([])
    // Why the word is not simply in the badge's colour: that is too faint in this many places.
    expect(plain).toBe(74)
  })
})

describe('what code is drawn on', () => {
  it('is the surface of the site\'s own palette when there is no menu', () => {
    const { surface, highlight } = THEME_PRESETS.forest.colors
    expect(codeBackgrounds(themeOf('  preset: forest\n'))).toEqual({
      code: [[surface.light], [surface.dark]],
      highlighted: [[tinted(highlight.light, surface.light)], [tinted(highlight.dark, surface.dark)]],
    })
  })

  it('tints a highlighted line as the stylesheet does', () => {
    const css = readFileSync(new URL('../src/client/styles/base.css', import.meta.url), 'utf8')
    expect(css).toContain(`--sb-highlight-soft: color-mix(in oklab, var(--sb-highlight) ${LINE_HIGHLIGHT_STRENGTH * 100}%, transparent);`)
    // Three parts black in ten, over white.
    expect(tinted('#000000', '#ffffff')).toBe('#b3b3b3')
  })

  it('is the `code` colour where the site sets one, laid over the page when it is translucent', () => {
    const theme = themeOf('  colors:\n    background: "#ffffff"\n    code: { light: "rgb(0 0 0 / 0.5)", dark: "#101010" }\n')
    expect(codeBackgrounds(theme).code).toEqual([['#808080'], ['#101010']])
  })

  it('gathers, for each syntax theme, the surface of every preset on the menu that uses it', () => {
    const theme = themeOf('  picker: true\n')
    const plan = codeThemePlan(theme)
    const backgrounds = codeBackgrounds(theme)
    expect(backgrounds.code).toHaveLength(plan.themes.length)
    expect(backgrounds.highlighted).toHaveLength(plan.themes.length)
    for (const name of PRESET_NAMES) {
      const { surface, highlight } = THEME_PRESETS[name].colors
      MODES.forEach((mode, slot) => {
        const index = plan.keys.indexOf(plan.palettes[name]![slot]!)
        expect(backgrounds.code[index], `${name} ${mode}`).toContain(surface[mode])
        expect(backgrounds.highlighted[index], `${name} ${mode}`).toContain(tinted(highlight[mode], surface[mode]))
      })
    }
    // GitHub Light is the light theme of several presets, each with its own surface.
    expect(backgrounds.code[0]!.length).toBeGreaterThan(1)
  })

  it('leaves out a background it cannot read', () => {
    const theme = themeOf('  colors:\n    code: { light: "oklch(97% 0.01 250)", dark: "#101010" }\n')
    expect(codeBackgrounds(theme).code).toEqual([[], ['#101010']])
    expect(codeBackgrounds(theme).highlighted[0]).toEqual([])
  })
})

/** A little of several languages, so that most kinds of token appear. */
const SAMPLE = [
  // Lines 1 to 3 are highlighted: a comment, keywords, types and a number, all on the tint.
  '```ts {1-3}\n// A comment\nexport async function greet(name: string): Promise<number> {\n  const answer = 42 /* inline */\n  return `hello ${name}`.length + answer\n}\n```',
  '```css\n/* A comment */\n.card > a:hover { color: #1f6f43; margin: 0 auto 1.5rem; }\n@media (width < 40rem) { :root { --gap: 4px; } }\n```',
  '```yaml\n# A comment\ntheme:\n  preset: forest\n  picker: [ink, paper]\n  radius: 8px\n  bars: true\n```',
  '```md\n# Title\n\n> [!WARNING]\n> Read *this* and **that**, then `run` [a link](https://example.com).\n\n- one\n- two\n```',
  '```json\n{ "name": "docs", "private": true, "count": 3, "list": [null, 1.5] }\n```',
  '```bash\n# A comment\nnpm install shabd --save && echo "done: $HOME" | grep -v x > out.txt\n```',
  '```html\n<!-- A comment -->\n<a class="card" href="/guide" data-on>Guide &amp; more</a>\n```',
  '```py\n# A comment\n@dataclass\nclass Page:\n    title: str = "Home"\n    def words(self) -> int:\n        return len(self.title.split()) if self.title else 0\n```',
  '```\nplain text\n```',
].join('\n\n')

const SOURCE = { file: '/site/content/code.md', id: 'code.md', routePath: '/code', format: 'md' as const, source: SAMPLE }

/** The colour a page's code stylesheet gives each token class, for each syntax theme key. */
function coloursByKey(css: string, keys: string[]): Record<string, Map<string, string>> {
  const found: Record<string, Map<string, string>> = {}
  for (const key of keys) {
    const block = new RegExp(`:root\\[data-code=${key}\\]\\{((?:[^{}]*\\{[^{}]*\\})*)\\}`).exec(css)?.[1]
    if (block === undefined) throw new Error(`no rules for ${key}`)
    found[key] = new Map([...block.matchAll(/\.(sbk-[a-z0-9]+)\{--sb-tok:([^}]+)\}/g)].map((match) => [match[1]!, match[2]!]))
  }
  return found
}

/** The token classes on highlighted lines, and those on the other lines (the foreground on the <pre> among them). */
function classesByLine(html: string): { highlighted: Set<string>; plain: Set<string> } {
  const highlighted = new Set<string>()
  const plain = new Set<string>()
  for (const line of html.split('<span class="line').slice(1)) {
    const into = line.startsWith(' sb-line-highlight"') ? highlighted : plain
    for (const match of line.matchAll(/class="(?:shiki )?(sbk-[a-z0-9]+)"/g)) into.add(match[1]!)
  }
  for (const match of html.matchAll(/<pre class="shiki (sbk-[a-z0-9]+)"/g)) {
    plain.add(match[1]!)
    highlighted.add(match[1]!) // plain code on a highlighted line inherits it
  }
  return { highlighted, plain }
}

describe('code in every preset', () => {
  const theme = themeOf('  picker: true\n')
  const plan = codeThemePlan(theme)
  const compilerWith = (minContrast: number, fingerprint: string) =>
    new MarkdownCompiler({
      themes: { light: theme.code.light, dark: theme.code.dark },
      more: plan.themes.slice(2),
      backgrounds: codeBackgrounds(theme),
      minContrast,
      sandbox: false,
      fingerprint,
    })

  it('holds every token to 4.5:1 against what is behind it, in both modes', async () => {
    expect(theme.code.minContrast).toBe(4.5)
    const compiled = await compilerWith(theme.code.minContrast, 'floor').compile(SOURCE)
    const colours = coloursByKey(themedCodeCss(plan.keys, compiled.codeColours), plan.keys)
    const classes = classesByLine(await renderCompiled(compiled.code))
    expect(classes.plain.size).toBeGreaterThan(8)
    expect(classes.highlighted.size).toBeGreaterThan(4)

    const misses: string[] = []
    for (const name of PRESET_NAMES) {
      const { surface, highlight } = THEME_PRESETS[name].colors
      MODES.forEach((mode, slot) => {
        const ofKey = colours[plan.palettes[name]![slot]!]!
        const check = (names: Set<string>, background: string, where: string) => {
          for (const token of names) {
            const colour = ofKey.get(token)
            if (!colour) throw new Error(`${name} ${mode}: no colour for ${token}`)
            const ratio = contrastOn(parseColor(colour) as Rgba, parseColor(background) as Rgba)
            if (ratio < 4.5) misses.push(`${name} ${mode}: ${colour} on ${where} ${background} is ${ratio.toFixed(2)}`)
          }
        }
        check(classes.plain, surface[mode], 'the code background')
        check(classes.highlighted, tinted(highlight[mode], surface[mode]), 'a highlighted line')
      })
    }
    expect(misses).toEqual([])
  }, 60_000)

  it('leaves the syntax themes as they are when the floor is 0', async () => {
    const untouched = await compilerWith(0, 'no-floor').compile(SOURCE)
    const colours = coloursByKey(themedCodeCss(plan.keys, untouched.codeColours), plan.keys)
    // Everforest Light, on the Forest preset, as it ships: its yellow is 2.05:1 on that surface.
    const key = plan.palettes.forest![0]!
    const { surface } = THEME_PRESETS.forest.colors
    const lowest = Math.min(
      ...[...colours[key]!.values()].map((colour) => contrastOn(parseColor(colour) as Rgba, parseColor(surface.light) as Rgba)),
    )
    expect(lowest).toBeLessThan(3)

    // And it is the same stylesheet as from a compiler that was told nothing about backgrounds.
    const plainCompiler = new MarkdownCompiler({
      themes: { light: theme.code.light, dark: theme.code.dark },
      more: plan.themes.slice(2),
      sandbox: false,
      fingerprint: 'no-backgrounds',
    })
    const plain = await plainCompiler.compile(SOURCE)
    expect(untouched.codeCss).toBe(plain.codeCss)
    expect(untouched.codeColours).toEqual(plain.codeColours)
  }, 60_000)
})
