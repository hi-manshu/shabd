import { describe, expect, it } from 'vitest'
import { isShabdError, type ShabdError } from '../src/node/config/errors.js'
import { parseSidebar, resolveConfig } from '../src/node/config/load.js'
import { renderDocument } from '../src/node/build/html.js'
import { colorModeScript, paletteChoices, themeBaseCss, themePaletteCss, themeToCss } from '../src/node/config/theme-css.js'
import { HEADER_MUTED, PRESET_NAMES, THEME_PRESETS, codeThemePlan, type ThemePreset } from '../src/shared/presets.js'

const load = (yaml: string) => resolveConfig('/site', '/site/shabd.config.yaml', yaml)

function failure(run: () => unknown): ShabdError {
  try {
    run()
  } catch (error) {
    if (isShabdError(error)) return error
    throw error
  }
  throw new Error('expected a ShabdError')
}

describe('shabd.config.yaml', () => {
  it('fills in defaults from a minimal config', () => {
    const { config, layouts } = load('site:\n  title: Docs\n')
    expect(config.site.base).toBe('/')
    expect(config.content.dir).toBe('content')
    expect(config.defaults.layout).toBe('doc')
    expect(config.defaults.toc).toEqual({ minDepth: 2, maxDepth: 3 })
    expect(config.theme.colorMode).toEqual({ default: 'system', toggle: true })
    expect(config.features.search).toMatchObject({ enabled: true, semantic: true })
    expect(Object.keys(layouts).sort()).toEqual(['api', 'base', 'doc', 'splash'])
  })

  it('takes a logo with a size, a link of its own and no title beside it', () => {
    const { site } = load(
      'site:\n  title: Docs\n  logo:\n    light: /l.svg\n    dark: /d.svg\n    alt: Acme\n    height: 2.25rem\n    href: https://acme.example\n    replacesTitle: true\n',
    ).config
    expect(site.logo).toEqual({
      light: '/l.svg',
      dark: '/d.svg',
      alt: 'Acme',
      height: '2.25rem',
      href: 'https://acme.example',
      replacesTitle: true,
    })
    const error = failure(() => load('site:\n  title: Docs\n  logo:\n    src: /l.svg\n    height: "2rem; color: red"\n'))
    expect(error.issues[0]).toMatchObject({ path: ['site', 'logo', 'height'], line: 5 })
  })

  it('normalizes shorthands to one canonical shape', () => {
    const { config } = load(`
site:
  title: Docs
  base: docs
  logo: /logo.svg
  repo: https://github.com/acme/docs
  social:
    github: https://github.com/acme
  nav:
    - { label: Guide, link: /guide, badge: New }
theme:
  colors:
    accent: "#ff0000"
features:
  search: false
  mcp: { route: /agents }
`)
    expect(config.site.base).toBe('/docs/')
    expect(config.site.logo).toEqual({
      light: '/logo.svg',
      dark: '/logo.svg',
      alt: '',
      height: '1.75rem',
      href: '/',
      replacesTitle: false,
    })
    expect(config.site.repo).toEqual({ url: 'https://github.com/acme/docs', branch: 'main', dir: '' })
    expect(config.site.social).toEqual([{ icon: 'github', href: 'https://github.com/acme', label: 'github' }])
    expect(config.site.nav[0]?.badge).toEqual({ text: 'New', variant: 'success' })
    expect(config.theme.colors.accent).toEqual({ light: '#ff0000', dark: '#ff0000' })
    expect(config.features.search.enabled).toBe(false)
    expect(config.features.search.model).toBe('Xenova/all-MiniLM-L6-v2')
    expect(config.features.mcp).toEqual({ enabled: true, route: '/agents', semantic: true })
  })

  it('takes the embedding model from Hugging Face unless the site is to serve it', () => {
    expect(load('site:\n  title: Docs\n').config.features.search.modelSource).toBe('huggingface')
    const served = load('site:\n  title: Docs\nfeatures:\n  search: { modelSource: site }\n')
    expect(served.config.features.search.modelSource).toBe('site')
    const error = failure(() => load('site:\n  title: Docs\nfeatures:\n  search: { modelSource: cdn }\n'))
    expect(error.issues[0]?.path).toEqual(['features', 'search', 'modelSource'])
    expect(error.issues[0]?.line).toBe(4)
  })

  it('points at the line and column of a typo and suggests the fix', () => {
    const error = failure(() => load('site:\n  title: Docs\n  descripton: Hello\n'))
    expect(error.issues).toHaveLength(1)
    expect(error.issues[0]).toMatchObject({
      path: ['site', 'descripton'],
      message: 'Unknown key "descripton". Did you mean "description"?',
      line: 3,
      column: 3,
    })
    expect(error.frame).toContain('descripton: Hello')
    expect(error.loc).toEqual({ file: '/site/shabd.config.yaml', line: 3, column: 3 })
  })

  it('reports a missing required key against its parent', () => {
    const error = failure(() => load('site:\n  description: Hello\n'))
    expect(error.issues[0]).toMatchObject({ path: ['site', 'title'], line: 1, column: 1 })
  })

  it('reports every problem at once, in file order', () => {
    const error = failure(() =>
      load('site:\n  title: Docs\ntheme:\n  colorMode:\n    default: night\n  colors:\n    accent: "red; }"\n'),
    )
    expect(error.issues.map((issue) => [issue.line, issue.path.join('.')])).toEqual([
      [5, 'theme.colorMode.default'],
      [7, 'theme.colors.accent'],
    ])
    expect(error.issues[1]?.message).toMatch(/single CSS value/)
  })

  it('reports YAML syntax errors with a position', () => {
    const error = failure(() => load('site:\n  title: "Docs\n'))
    expect(error.issues[0]?.line).toBeGreaterThan(0)
  })

  it('rejects unknown blocks and names the ones that exist', () => {
    const error = failure(() =>
      load('site:\n  title: Docs\nlayouts:\n  doc:\n    regions:\n      aside:\n        - toc\n        - tco\n'),
    )
    expect(error.issues[0]).toMatchObject({ path: ['layouts', 'doc', 'regions', 'aside', 1], line: 8 })
    expect(error.issues[0]?.message).toMatch(/Unknown block "tco"/)
  })

  it('rejects layouts that extend each other in a loop', () => {
    const error = failure(() =>
      load('site:\n  title: Docs\nlayouts:\n  a:\n    extends: b\n  b:\n    extends: a\n'),
    )
    expect(error.issues[0]?.message).toMatch(/loop/)
  })

  it('lets a user layout edit a built-in region by region', () => {
    const { layouts } = load('site:\n  title: Docs\nlayouts:\n  doc:\n    regions:\n      aside: []\n')
    expect(layouts.doc?.regions.aside).toEqual([])
    expect(layouts.doc?.regions.sidebar).toEqual([{ block: 'sidebar-nav', props: {} }])
    expect(layouts.doc?.regions.header?.[0]).toEqual({ block: 'menu-toggle', props: {} })
  })

  it('flattens `extends` for custom layouts', () => {
    const { layouts } = load(`
site: { title: Docs }
layouts:
  changelog:
    extends: doc
    width: wide
    regions:
      aside: []
      main: [page-header, content]
`)
    expect(layouts.changelog).toMatchObject({ name: 'changelog', width: 'wide' })
    expect(layouts.changelog?.regions.main?.map((b) => b.block)).toEqual(['page-header', 'content'])
    expect(layouts.changelog?.regions.sidebar?.map((b) => b.block)).toEqual(['sidebar-nav'])
  })
})

describe('theme presets and the reader\'s menu', () => {
  const theme = (yaml: string) => load(`site: { title: Docs }\ntheme:\n${yaml}`).config.theme
  const MACOS_SIDEBAR = (THEME_PRESETS.macos as ThemePreset).look!.colors!.sidebar!

  it('starts from the default preset', () => {
    const { theme: defaults } = load('site: { title: Docs }\n').config
    expect(defaults.preset).toBe('shabd')
    expect(defaults.colors).toEqual(THEME_PRESETS.shabd.colors)
    expect(defaults.code).toMatchObject(THEME_PRESETS.shabd.code)
    expect(defaults.picker).toEqual([])
  })

  it('gives every code frame the same tokens, so that a change of frame leaves nothing of the last one behind', () => {
    const tokens = (frame: string) =>
      [...themeBaseCss(theme(`  code:\n    frame: ${frame}\n`)).matchAll(/--sb-(code-[a-z-]+):/g)].map((match) => match[1]).sort()
    expect(tokens('bar').length).toBeGreaterThan(10)
    expect(tokens('window')).toEqual(tokens('bar'))
    expect(tokens('xp')).toEqual(tokens('bar'))

    // The Windows XP preset brings its own frame: buttons at the right of a title bar, not at the left.
    const xp = theme('  preset: xp\n')
    expect(xp.code.frame).toBe('xp')
    expect(themeBaseCss(xp)).toContain('--sb-code-caption: block;')
    expect(themeBaseCss(xp)).toContain('--sb-code-dots: none;')
    expect(themeBaseCss(theme('  preset: macos\n'))).toContain('--sb-code-caption: none;')
  })

  it('holds code to a contrast of 4.5:1 unless told otherwise', () => {
    expect(theme('  preset: forest\n').code.minContrast).toBe(4.5)
    expect(theme('  code:\n    minContrast: 0\n').code.minContrast).toBe(0)
    expect(theme('  code:\n    minContrast: 7\n').code.minContrast).toBe(7)
    expect(failure(() => theme('  code:\n    minContrast: 22\n')).message).toContain('minContrast')
    expect(failure(() => theme('  code:\n    minContrast: -1\n')).message).toContain('minContrast')
  })

  it('lays `colors` and `code` over the preset that is named', () => {
    const forest = theme('  preset: forest\n  colors:\n    accent: "#005500"\n  code:\n    dark: nord\n')
    expect(forest.colors.accent).toEqual({ light: '#005500', dark: '#005500' })
    expect(forest.colors.background).toEqual(THEME_PRESETS.forest.colors.background)
    expect(forest.code).toMatchObject({ light: THEME_PRESETS.forest.code.light, dark: 'nord' })
  })

  it('takes fonts, corners, rules and bars from a preset that has a look', () => {
    const macos = theme('  preset: macos\n')
    expect(macos.typography.sans).toMatch(/^-apple-system/)
    expect(macos.typography.heading).toBe(macos.typography.sans)
    expect(macos.typography).toMatchObject({ weight: 400, headingWeight: 600, headingWidth: 100, displayWidth: 100 })
    expect(macos).toMatchObject({ radius: '10px', corners: 'round', rule: '1px', bars: false })
    expect(macos.code.frame).toBe('window')
    // The preset's own value, whatever it is tuned to: translucent, so that it reads as frosted glass.
    expect(macos.colors.sidebar).toEqual(MACOS_SIDEBAR)
    expect(MACOS_SIDEBAR.light).toMatch(/^rgb\(.+ \/ 0\.\d+\)$/)

    const css = themeToCss(macos)
    expect(css).toMatch(/^:root \{[^}]*--sb-title-bar: 0px;[^}]*--sb-hero-bar: 0px;/)
    expect(css).toMatch(/^:root \{[^}]*--sb-hang: var\(--sb-radius\);/)
    expect(css).toMatch(/^:root \{[^}]*--sb-header: rgb\(255 255 255 \/ 0\.72\);/)
    expect(css).toMatch(/:root\[data-theme='dark'\] \{[^}]*--sb-header: rgb\(30 30 30 \/ 0\.7\);/)
  })

  it('frames code as a window, frosts the panels and colours the button for the macOS look', () => {
    const css = themeToCss(theme('  preset: macos\n'))
    // The window: its three buttons, a centred title and a shadow.
    expect(css).toMatch(/^:root \{[^}]*--sb-code-dots: block;[^}]*--sb-code-bar-columns: 1fr auto 1fr;/)
    expect(css).toMatch(/^:root \{[^}]*--sb-code-shadow: 0 0\.9rem/)
    // Frost needs something behind it, and the content area needs to stay solid in front of that.
    expect(css).toMatch(/^:root \{[^}]*--sb-backdrop: radial-gradient\(/)
    expect(css).toMatch(/:root\[data-theme='dark'\] \{[^}]*--sb-backdrop: radial-gradient\(46rem 34rem at 0% 8%, rgb\(30 95 200/)
    expect(css).toMatch(/^:root \{[^}]*--sb-main: #ffffff;/)
    expect(css).toMatch(/^:root \{[^}]*--sb-button: #0071e3;/)

    const plain = themeToCss(theme('  radius: 8px\n'))
    expect(plain).toMatch(/^:root \{[^}]*--sb-code-dots: none;[^}]*--sb-code-bar-columns: 1fr auto;/)
    expect(plain).toMatch(/^:root \{[^}]*--sb-shadow: none;/)
    expect(plain).toMatch(/^:root \{[^}]*--sb-code-shadow: var\(--sb-shadow\);/)
    expect(plain).toMatch(/^:root \{[^}]*--sb-backdrop: none;/)
    expect(plain).toMatch(/^:root \{[^}]*--sb-main: transparent;/)
    expect(plain).toMatch(/^:root \{[^}]*--sb-button: var\(--sb-text\);/)
    // Unset, plain code keeps the syntax theme's colour: `initial` makes the stylesheet's fallback apply.
    expect(plain).toMatch(/^:root \{[^}]*--sb-code-text: initial;/)
    expect(css).toMatch(/^:root \{[^}]*--sb-code-text: #1d1d1f;/)
    expect(css).toMatch(/:root\[data-theme='dark'\] \{[^}]*--sb-code-text: #f5f5f7;/)
  })

  it('gives a look its line weight, shadow and heading style, from a preset or from the site', () => {
    const brutal = theme('  preset: brutal\n')
    expect(brutal).toMatchObject({ line: '2px', rule: '3px', radius: '0px', shadow: '4px 4px 0 var(--sb-text)' })
    expect(brutal.typography.heading).toMatch(/^"Arial Black"/)
    expect(brutal.typography.sans).toMatch(/^"Helvetica Neue"/)
    const css = themeToCss(brutal)
    expect(css).toMatch(/^:root \{[^}]*--sb-line: 2px;/)
    expect(css).toMatch(/^:root \{[^}]*--sb-shadow: 4px 4px 0 var\(--sb-text\);/)

    const blueprint = theme('  preset: blueprint\n')
    expect(blueprint.typography).toMatchObject({ headingCase: 'uppercase', headingTracking: '0.03em' })
    expect(themeToCss(blueprint)).toMatch(/^:root \{[^}]*--sb-heading-case: uppercase;[^}]*--sb-heading-tracking: 0\.03em;/)

    // A site that names its own text font gets it for headings too, not the preset's heading font.
    const mine = theme('  preset: brutal\n  shadow: none\n  typography:\n    sans: Inter, sans-serif\n    headingCase: uppercase\n')
    expect(mine.typography.heading).toBe('Inter, sans-serif')
    expect(mine.typography.headingCase).toBe('uppercase')
    expect(mine.shadow).toBe('none')

    const defaults = themeToCss(theme('  radius: 8px\n'))
    expect(defaults).toMatch(/^:root \{[^}]*--sb-heading-case: none;[^}]*--sb-heading-tracking: 0em;/)
    expect(defaults).toMatch(/^:root \{[^}]*--sb-line: 1px;/)
  })

  it('tells the reader\'s menu which presets bring a look', () => {
    const choices = paletteChoices(theme('  picker: [ink, macos, brutal]\n'))
    expect(choices.map((choice) => [choice.name, choice.look])).toEqual([
      ['shabd', false],
      ['ink', false],
      ['macos', true],
      ['brutal', true],
    ])
  })

  it('plans one syntax theme per distinct name, and tells the menu which a preset uses', () => {
    const picked = theme('  picker: [ink, contrast, brutal]\n')
    const plan = codeThemePlan(picked)
    // Contrast and Brutal use the same pair, so they add two themes between them, not four.
    expect(plan.themes).toEqual([
      'github-light',
      'tokyo-night',
      'github-dark',
      'github-light-high-contrast',
      'github-dark-high-contrast',
    ])
    expect(plan.keys).toEqual(['light', 'dark', 't2', 't3', 't4'])
    expect(plan.palettes).toEqual({
      shabd: ['light', 'dark'],
      ink: ['light', 't2'],
      contrast: ['t3', 't4'],
      brutal: ['t3', 't4'],
    })
    expect(paletteChoices(picked).map((choice) => choice.code)).toEqual([
      ['light', 'dark'],
      ['light', 't2'],
      ['t3', 't4'],
      ['t3', 't4'],
    ])
    // No menu: the site's own two and nothing else.
    expect(codeThemePlan(theme('  radius: 8px\n')).themes).toEqual(['github-light', 'tokyo-night'])
  })

  it('lets any site frame its code as a window', () => {
    const framed = theme('  code:\n    frame: window\n')
    expect(framed.code.frame).toBe('window')
    expect(framed.preset).toBe('shabd')
    expect(themeToCss(framed)).toMatch(/^:root \{[^}]*--sb-code-dots: block;/)
    const error = failure(() => load('site:\n  title: Docs\ntheme:\n  code:\n    frame: glass\n'))
    expect(error.issues[0]).toMatchObject({ path: ['theme', 'code', 'frame'], line: 5 })
  })

  it('puts a site\'s own settings before the preset\'s look', () => {
    const mine = theme('  preset: macos\n  corners: hang\n  bars: true\n  typography:\n    sans: Inter, sans-serif\n  colors:\n    sidebar: "#ffffff"\n')
    expect(mine).toMatchObject({ corners: 'hang', bars: true, radius: '10px' })
    expect(mine.typography.sans).toBe('Inter, sans-serif')
    expect(mine.typography.heading).toBe('Inter, sans-serif')
    expect(mine.typography.mono).toMatch(/^"SF Mono"/)
    expect(mine.colors.sidebar).toEqual({ light: '#ffffff', dark: '#ffffff' })
    expect(themeToCss(mine)).toMatch(/^:root \{[^}]*--sb-title-bar: 0\.16em;/)
  })

  it('writes the header in the page\'s colours until it is given an ink of its own', () => {
    // The body of one rule. No rule in the theme has braces inside it.
    const block = (css: string, selector: string) => {
      const start = css.indexOf(`${selector} {`)
      return start < 0 ? '' : css.slice(start, css.indexOf('}', start))
    }

    const plain = themeToCss(theme('  radius: 8px\n'))
    const page = block(plain, ':root')
    expect(page).toContain('--sb-header-text: var(--sb-text);')
    expect(page).toContain('--sb-header-muted: var(--sb-muted);')
    expect(page).toContain('--sb-header-hover: var(--sb-surface);')
    expect(page).toContain('--sb-header-focus: var(--sb-accent);')
    // No value, so that a badge in the header keeps the colour of its kind.
    expect(page).toContain('--sb-header-badge: initial;')
    // The logo follows the page: the one drawn for a light page in the light mode, the other in the dark.
    expect(page).toContain('--sb-header-logo-light: inline-block;')
    expect(page).toContain('--sb-header-logo-dark: none;')
    const night = block(plain, ":root[data-theme='dark']")
    expect(night).toContain('--sb-header-logo-light: none;')
    expect(night).toContain('--sb-header-logo-dark: inline-block;')
    // The rest follows the page's colours by itself, and is not written twice.
    expect(night).not.toContain('--sb-header-muted')

    // A dark bar on a light page, and a light one on a dark page.
    const own = theme('  colors:\n    header: { light: "#102a43", dark: "#f0f4f8" }\n    headerText: { light: "#ffffff", dark: "#102a43" }\n')
    expect(own.colors.headerText).toEqual({ light: '#ffffff', dark: '#102a43' })
    const css = themeToCss(own)
    const light = block(css, ':root')
    expect(light).toContain('--sb-header-text: #ffffff;')
    // The quieter tones are made from the ink, see-through so that they are right on any header.
    expect(light).toContain(`--sb-header-muted: color-mix(in oklab, var(--sb-header-text) ${HEADER_MUTED * 100}%, transparent);`)
    expect(light).toContain('--sb-header-hover: color-mix(in oklab, var(--sb-header-text) 14%, transparent);')
    expect(light).toContain('--sb-header-focus: var(--sb-header-text);')
    expect(light).toContain('--sb-header-badge: var(--sb-header-text);')
    // A light ink means a dark bar, which takes the logo drawn for the dark, whatever the page is.
    expect(light).toContain('--sb-header-logo-light: none;')
    expect(light).toContain('--sb-header-logo-dark: inline-block;')
    const dark = block(css, ":root[data-theme='dark']")
    expect(dark).toContain('--sb-header-text: #102a43;')
    expect(dark).toContain('--sb-header-logo-light: inline-block;')
    expect(dark).toContain('--sb-header-logo-dark: none;')

    // An ink that cannot be read here says nothing about the bar, and the logo follows the page.
    const unread = block(themeToCss(theme('  colors:\n    headerText: var(--brand-ink)\n')), ':root')
    expect(unread).toContain('--sb-header-text: var(--brand-ink);')
    expect(unread).toContain('--sb-header-logo-light: inline-block;')

    // A preset from the menu sets all of it again: the site's header may have an ink, and the preset's may not.
    const menu = themeToCss(theme('  picker: [xp, forest]\n  colors:\n    headerText: "#ffffff"\n'))
    const forest = block(menu, ":root[data-palette='forest']")
    expect(forest).toContain('--sb-header-text: var(--sb-text);')
    expect(forest).toContain('--sb-header-muted: var(--sb-muted);')
    expect(forest).toContain('--sb-header-logo-light: inline-block;')
    // Windows XP has a blue bar written in white.
    const xp = block(menu, ":root[data-palette='xp']")
    expect(xp).toContain('--sb-header-text: #ffffff;')
    expect(xp).toContain('--sb-header-focus: var(--sb-header-text);')
    expect(xp).toContain('--sb-header-logo-dark: inline-block;')
  })

  it('gives a reader who picks a preset its look as well as its colours', () => {
    const css = themeToCss(theme('  picker: [macos, forest]\n'))
    // The body of one rule. No rule in the theme has braces inside it.
    const block = (selector: string) => {
      const start = css.indexOf(`\n${selector} {`)
      return start < 0 ? '' : css.slice(start, css.indexOf('}', start))
    }
    const macos = block(":root[data-palette='macos']")
    expect(macos).toContain('--sb-font-sans: -apple-system')
    expect(macos).toContain('--sb-font-heading: -apple-system')
    expect(macos).toContain('--sb-hang: var(--sb-radius);')
    expect(macos).toContain('--sb-title-bar: 0px;')
    expect(macos).toContain('--sb-code-dots: block;')
    expect(macos).toContain(`--sb-sidebar: ${MACOS_SIDEBAR.light};`)
    expect(block(":root[data-palette='macos'][data-theme='dark']")).toContain(`--sb-sidebar: ${MACOS_SIDEBAR.dark};`)
    // A preset that is only a palette leaves the site's fonts and corners as they are.
    const forest = block(":root[data-palette='forest']")
    expect(forest).toContain('--sb-accent: #1f6f43;')
    expect(forest).not.toContain('--sb-font-sans')
    expect(forest).not.toContain('--sb-hang')
    expect(forest).toContain('--sb-backdrop: none;')
  })

  it('rejects a preset that does not exist, on its line', () => {
    const error = failure(() => load('site:\n  title: Docs\ntheme:\n  preset: forrest\n'))
    expect(error.issues[0]).toMatchObject({ path: ['theme', 'preset'], line: 4 })
  })

  it('offers every preset for `picker: true`, the site\'s own first', () => {
    const all = theme('  preset: ocean\n  picker: true\n')
    expect(all.picker[0]).toBe('ocean')
    expect([...all.picker].sort()).toEqual([...PRESET_NAMES].sort())

    const some = theme('  picker: [ink, forest]\n')
    expect(some.picker).toEqual(['shabd', 'ink', 'forest'])
    expect(paletteChoices(some).map((choice) => choice.label)).toEqual(['Shabd', 'Ink', 'Forest'])
  })

  it('shows the site\'s own colours in its swatch, overrides included', () => {
    const [own, ink] = paletteChoices(theme('  picker: [ink]\n  colors:\n    accent: { light: "#111111", dark: "#eeeeee" }\n'))
    expect(own?.swatch.light[1]).toBe('#111111')
    expect(own?.swatch.dark[1]).toBe('#eeeeee')
    expect(ink?.swatch.light).toEqual(['#ffffff', '#1d4ed8', '#60a5fa'])
  })

  it('writes a rule per offered palette and mode, and none for the site\'s own', () => {
    const css = themeToCss(theme('  picker: [forest]\n'))
    expect(css).toMatch(/:root\[data-palette='forest'\] \{[^}]*--sb-accent: #1f6f43;[^}]*color-scheme: light;/)
    expect(css).toMatch(/:root\[data-palette='forest'\]\[data-theme='dark'\] \{[^}]*--sb-accent: #7fd69b;[^}]*color-scheme: dark;/)
    expect(css).not.toContain("data-palette='shabd'")
    expect(themeToCss(theme('  radius: 4px\n'))).not.toContain('data-palette')
  })

  it('keeps the menu\'s presets apart from the site\'s own tokens, so a build can ship them as one file', () => {
    const picked = theme('  picker: [forest]\n')
    expect(themeBaseCss(picked)).toContain('--sb-accent: #2b36a8;')
    expect(themeBaseCss(picked)).not.toContain('data-palette')
    expect(themePaletteCss(picked)).toMatch(/^:root\[data-palette='forest'\] \{/)
    expect(themeToCss(picked)).toBe(`${themeBaseCss(picked)}\n${themePaletteCss(picked)}`)
    expect(themePaletteCss(theme('  radius: 4px\n'))).toBe('')

    const { config } = load('site: { title: Docs }\ntheme:\n  picker: [forest]\n')
    const page = { config, title: 'Home', description: '', path: '/' }
    const linked = renderDocument({ ...page, paletteStylesheet: '/_shabd/palettes.abc12345.css' })
    expect(linked).toContain('<link rel="stylesheet" href="/_shabd/palettes.abc12345.css">')
    expect(linked).not.toContain('data-palette=')
    // The link comes after the site's own tokens, which the presets have to outrank.
    expect(linked.indexOf('id="sb-theme"')).toBeLessThan(linked.indexOf('palettes.abc12345.css'))
    expect(renderDocument(page)).toContain(":root[data-palette='forest']")
  })

  it('puts optional colours back to their fallbacks on a palette the reader picked', () => {
    const css = themeToCss(theme('  picker: [forest]\n  colors:\n    header: { light: "#101010", dark: "#202020" }\n'))
    expect(css).toMatch(/^:root \{[^}]*--sb-header: #101010;/)
    expect(css).toMatch(/:root\[data-theme='dark'\] \{[^}]*--sb-header: #202020;/)
    expect(css).toMatch(/:root\[data-palette='forest'\] \{[^}]*--sb-header: var\(--sb-background\);/)
    expect(css).toMatch(/:root\[data-palette='forest'\]\[data-theme='dark'\] \{[^}]*--sb-header: var\(--sb-background\);/)
  })

  it('applies a stored palette before paint only if the site still offers it', () => {
    const script = colorModeScript(theme('  picker: [ink, forest]\n'))
    expect(script).toContain(`localStorage.getItem('shabd-palette')`)
    // Each offered palette, with the syntax theme it uses in the light and the dark mode.
    // Ink's light theme is the site's own, so it shares the key `light`.
    expect(script).toContain('{"ink":["light","t2"],"forest":["t3","t4"]}')
    expect(colorModeScript(theme('  radius: 4px\n'))).not.toContain('shabd-palette')

    // Run it the way a browser would, with a stand-in for the page.
    const run = (stored: Record<string, string>) => {
      const dataset: Record<string, string> = {}
      const page = {
        document: { documentElement: { dataset } },
        localStorage: { getItem: (key: string) => stored[key] ?? null },
        matchMedia: () => ({ matches: true }),
      }
      new Function('document', 'localStorage', 'matchMedia', script)(page.document, page.localStorage, page.matchMedia)
      return dataset
    }
    expect(run({})).toEqual({ theme: 'dark' })
    expect(run({ 'shabd-theme': 'light', 'shabd-palette': 'forest' })).toEqual({ theme: 'light', palette: 'forest', code: 't3' })
    expect(run({ 'shabd-palette': 'forest' })).toEqual({ theme: 'dark', palette: 'forest', code: 't4' })
    expect(run({ 'shabd-palette': 'grape' })).toEqual({ theme: 'dark' })
    // A stored value that is a property of every object is not a palette.
    expect(run({ 'shabd-palette': 'constructor' })).toEqual({ theme: 'dark' })
  })
})

describe('theme tokens', () => {
  it('gives every optional colour a value, the site\'s or its fallback', () => {
    const css = themeToCss(load('site: { title: Docs }\ntheme:\n  colors:\n    link: "#0000ee"\n    bar: { light: "#aa0000", dark: "#ff8888" }\n').config.theme)
    expect(css).toMatch(/^:root \{[^}]*--sb-link: #0000ee;/)
    expect(css).toMatch(/^:root \{[^}]*--sb-bar: #aa0000;/)
    expect(css).toMatch(/:root\[data-theme='dark'\] \{[^}]*--sb-bar: #ff8888;/)
    expect(css).toMatch(/^:root \{[^}]*--sb-heading: var\(--sb-text\);/)
    expect(css).toMatch(/^:root \{[^}]*--sb-code: var\(--sb-surface\);/)
    expect(css).toMatch(/^:root \{[^}]*--sb-selection: color-mix\(/)
  })

  it('turns type, shape and width settings into tokens', () => {
    const { theme } = load(`site: { title: Docs }
theme:
  typography:
    heading: Georgia, serif
    weight: 450
    headingWeight: 600
    headingWidth: 100
    displayWidth: 110
  corners: round
  rule: 3px
  layout:
    wideWidth: 80rem
`).config
    const css = themeToCss(theme)
    expect(css).toContain('--sb-font-heading: Georgia, serif;')
    expect(css).toContain('--sb-font-weight: 450;')
    expect(css).toContain('--sb-heading-weight: 600;')
    expect(css).toContain('--sb-wide: 100%;')
    expect(css).toContain('--sb-wider: 110%;')
    expect(css).toContain('--sb-hang: var(--sb-radius);')
    expect(css).toContain('--sb-rule: 3px;')
    expect(css).toContain('--sb-wide-width: 80rem;')

    const defaults = load('site: { title: Docs }\n').config.theme
    expect(defaults.typography.heading).toBe(defaults.typography.sans)
    expect(themeToCss(defaults)).toContain('--sb-hang: 0 0 var(--sb-radius) var(--sb-radius);')
  })

  it('compiles YAML tokens to CSS custom properties for both colour modes', () => {
    const { config } = load('site: { title: Docs }\ntheme:\n  typography: { scale: 1.25 }\n  colors:\n    accent: { light: "#123456", dark: "#abcdef" }\n')
    const css = themeToCss(config.theme)
    expect(css).toContain('--sb-accent: #123456;')
    expect(css).toMatch(/:root\[data-theme='dark'\] \{[^}]*--sb-accent: #abcdef;/)
    expect(css).toContain('--sb-step-1: 1.250rem;')
    expect(css).toContain('--sb-step-2: 1.563rem;')
  })
})

describe('sidebar.yaml validation', () => {
  it('accepts every entry kind', () => {
    const { input } = parseSidebar(
      '/site/sidebar.yaml',
      `
- guide/intro
- category: Guide
  items:
    - file: guide/install
      badge: New
    - folder: Writing
      collapsed: true
      items: [guide/writing/markdown]
    - link: https://example.com
      label: Example
- category: Reference
  autogenerate: reference
`,
    )
    expect(input).toHaveLength(3)
  })

  it('explains a mistyped key inside a nested entry', () => {
    const error = failure(() =>
      parseSidebar('/site/sidebar.yaml', '- category: Guide\n  items:\n    - file: guide/install\n      bagde: New\n'),
    )
    expect(error.issues).toHaveLength(1)
    expect(error.issues[0]).toMatchObject({
      path: [0, 'items', 0, 'bagde'],
      message: 'Unknown key "bagde". Did you mean "badge"?',
      line: 4,
    })
  })

  it('requires a folder to say where its items come from', () => {
    const error = failure(() => parseSidebar('/site/sidebar.yaml', '- folder: Empty\n'))
    expect(error.issues[0]?.message).toMatch(/either `items` or `autogenerate`/)
  })

  it('only allows categories at the top level', () => {
    const error = failure(() =>
      parseSidebar('/site/sidebar.yaml', '- category: A\n  items:\n    - category: B\n      items: [x]\n'),
    )
    expect(error.issues.length).toBeGreaterThan(0)
  })

  it('treats an empty file as an empty sidebar', () => {
    expect(parseSidebar('/site/sidebar.yaml', '# nothing yet\n').input).toEqual([])
  })
})
