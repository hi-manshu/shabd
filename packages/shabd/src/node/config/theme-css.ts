/**
 * Theme tokens (YAML) → CSS custom properties.
 *
 * The stylesheet in src/client/styles never names a colour or a size; it only
 * reads these variables. Changing the look of a site is a YAML edit.
 */
import {
  COLOR_MODE_KEY,
  COLOR_TOKENS,
  OPTIONAL_COLOR_TOKENS,
  PALETTE_KEY,
  THEME_PRESETS,
  codeThemePlan,
  type Look,
  type ModeColor,
  type OptionalColorToken,
  type PresetName,
} from '../../shared/presets.js'
import type { ThemeConfig } from '../../shared/schema.js'
import type { PaletteChoice } from '../../shared/types.js'

/** Steps of the modular scale exposed as `--sb-step-N`. */
const SCALE_STEPS = [-2, -1, 0, 1, 2, 3, 4, 5, 6] as const

/** What an optional colour is when a site does not set it. */
const OPTIONAL_COLOR_FALLBACKS: Record<OptionalColorToken, string> = {
  link: 'var(--sb-accent)',
  heading: 'var(--sb-text)',
  bar: 'var(--sb-text)',
  button: 'var(--sb-text)',
  header: 'var(--sb-background)',
  sidebar: 'var(--sb-background)',
  main: 'transparent',
  code: 'var(--sb-surface)',
  // No value of its own: the stylesheet then falls back to the syntax theme's foreground, token by token.
  codeText: 'initial',
  selection: 'color-mix(in oklab, var(--sb-highlight) 60%, transparent)',
  backdrop: 'none',
}

/**
 * How a code block is framed. The stylesheet has one set of rules for every
 * frame and reads the difference from these, so a reader's palette can
 * change the frame without the markup changing.
 */
/** What a frame leaves to the palette: the border, the rule on top, the corners and the ink of the strip. */
const PLAIN_FRAME = {
  'code-border': 'var(--sb-line) solid var(--sb-border)',
  'code-rule-width': 'var(--sb-rule)',
  'code-radius': 'var(--sb-hang)',
  'code-caption': 'none',
  'code-bar-ink': 'var(--sb-text)',
  'code-bar-muted': 'var(--sb-muted)',
}

const CODE_FRAME_TOKENS: Record<Look['codeFrame'], Record<string, string>> = {
  bar: {
    ...PLAIN_FRAME,
    'code-dots': 'none',
    'code-bar-columns': '1fr auto',
    'code-bar-padding': '0.3rem 0.4rem 0 0.95rem',
    'code-bar-background': 'transparent',
    'code-bar-rule': '0px',
    'code-label-weight': 'inherit',
    // A code block that hangs from a rule takes the same shadow as any other panel.
    'code-shadow': 'var(--sb-shadow)',
  },
  window: {
    ...PLAIN_FRAME,
    'code-dots': 'block',
    // Equal columns either side keep the title in the middle of the window, whatever sits beside it.
    'code-bar-columns': '1fr auto 1fr',
    'code-bar-padding': '0.3rem 0.5rem 0.3rem 0.8rem',
    'code-bar-background': 'color-mix(in oklab, var(--sb-text) 6%, var(--sb-code))',
    'code-bar-rule': '1px',
    'code-label-weight': '600',
    'code-shadow': '0 0.9rem 2.2rem rgb(0 0 0 / 0.16), 0 0.15rem 0.4rem rgb(0 0 0 / 0.1)',
  },
  // A picture of a window, like the buttons of the other one: it is blue with white lettering on any palette.
  xp: {
    'code-border': '3px solid #0a4fd3',
    // The title bar is the top of the window, so nothing is ruled above it.
    'code-rule-width': '0px',
    'code-radius': '8px 8px 0 0',
    'code-caption': 'block',
    'code-bar-ink': '#ffffff',
    'code-bar-muted': '#ffffff',
    'code-dots': 'none',
    // The title at the left, then whatever button the block has, then the window's own three.
    'code-bar-columns': '1fr auto auto',
    'code-bar-padding': '0.25rem 0.3rem 0.25rem 0.6rem',
    'code-bar-background': 'linear-gradient(180deg, #3b93ff 0%, #0b61ea 10%, #0a55dd 48%, #0e66f2 86%, #0a4fd0 100%)',
    'code-bar-rule': '0px',
    'code-label-weight': '700',
    'code-shadow': '0.15rem 0.2rem 0.5rem rgb(0 0 0 / 0.3)',
  },
}

type Mode = keyof ModeColor

/** `codeText` in YAML is `--sb-code-text` in CSS. */
const cssName = (token: string) => token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

function declarations(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `  --sb-${name}: ${value};`)
    .join('\n')
}

const rule = (selector: string, body: string, scheme: Mode) => `${selector} {\n${body}\n  color-scheme: ${scheme};\n}`

/** The site's own colours in one mode. In the light mode every optional colour is set, to its fallback if need be. */
function siteColors(colors: ThemeConfig['colors'], mode: Mode): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const token of COLOR_TOKENS) vars[token] = colors[token][mode]
  for (const token of OPTIONAL_COLOR_TOKENS) {
    const value = colors[token]?.[mode]
    if (value !== undefined) vars[cssName(token)] = value
    else if (mode === 'light') vars[cssName(token)] = OPTIONAL_COLOR_FALLBACKS[token]
  }
  return vars
}

/**
 * A preset's colours in one mode, for a reader who picked it from the menu.
 * The optional colours are the preset's own or go back to their fallbacks:
 * a header colour chosen for the site's own palette does not belong on
 * another one.
 */
function presetColors(name: PresetName, mode: Mode): Record<string, string> {
  const preset = THEME_PRESETS[name]
  const vars: Record<string, string> = {}
  for (const token of COLOR_TOKENS) vars[token] = preset.colors[token][mode]
  for (const token of OPTIONAL_COLOR_TOKENS) {
    vars[cssName(token)] = preset.look?.colors?.[token]?.[mode] ?? OPTIONAL_COLOR_FALLBACKS[token]
  }
  return vars
}

/**
 * The tokens for a look, or for the part of one that is given. A preset
 * without fonts of its own leaves the site's fonts alone.
 */
function lookTokens(look: Partial<Look>): Record<string, string> {
  const vars: Record<string, string> = {}
  const heading = look.heading ?? look.sans
  if (look.sans !== undefined) vars['font-sans'] = look.sans
  if (look.mono !== undefined) vars['font-mono'] = look.mono
  if (heading !== undefined) vars['font-heading'] = heading
  if (look.headingCase !== undefined) vars['heading-case'] = look.headingCase
  if (look.headingTracking !== undefined) vars['heading-tracking'] = look.headingTracking
  if (look.weight !== undefined) vars['font-weight'] = String(look.weight)
  if (look.headingWeight !== undefined) vars['heading-weight'] = String(look.headingWeight)
  if (look.headingWidth !== undefined) vars.wide = `${look.headingWidth}%`
  if (look.displayWidth !== undefined) vars.wider = `${look.displayWidth}%`
  if (look.radius !== undefined) vars.radius = look.radius
  if (look.corners !== undefined) {
    // Flat on top, soft underneath: the shape of a letter hanging from its headline.
    vars.hang = look.corners === 'round' ? 'var(--sb-radius)' : '0 0 var(--sb-radius) var(--sb-radius)'
  }
  if (look.rule !== undefined) vars.rule = look.rule
  if (look.line !== undefined) vars.line = look.line
  if (look.shadow !== undefined) vars.shadow = look.shadow
  if (look.bars !== undefined) {
    vars['title-bar'] = look.bars ? '0.16em' : '0px'
    vars['hero-bar'] = look.bars ? '0.6rem' : '0px'
  }
  if (look.codeFrame !== undefined) Object.assign(vars, CODE_FRAME_TOKENS[look.codeFrame])
  return vars
}

/**
 * The site's own tokens: all a page needs while the reader has not picked
 * another preset. Small, and written into every document.
 */
export function themeBaseCss(theme: ThemeConfig): string {
  const { typography, layout } = theme

  const scale = Object.fromEntries(
    SCALE_STEPS.map((step) => [`step-${step}`, `${Number(typography.scale ** step).toFixed(3)}rem`]),
  )

  const base = declarations({
    ...lookTokens({
      ...typography,
      radius: theme.radius,
      corners: theme.corners,
      rule: theme.rule,
      line: theme.line,
      shadow: theme.shadow,
      bars: theme.bars,
      codeFrame: theme.code.frame,
    }),
    'font-size': typography.baseSize,
    'line-height': String(typography.lineHeight),
    ...scale,
    'content-width': layout.contentWidth,
    'wide-width': layout.wideWidth,
    'sidebar-width': layout.sidebarWidth,
    'toc-width': layout.tocWidth,
    'header-height': layout.headerHeight,
  })

  const light = declarations(siteColors(theme.colors, 'light'))
  const dark = declarations(siteColors(theme.colors, 'dark'))

  // `data-theme` is set before first paint by the inline script in the HTML
  // shell. The media query covers visitors with JavaScript disabled.
  return [
    rule(':root', `${base}\n${light}`, 'light'),
    rule(`:root[data-theme='dark']`, dark, 'dark'),
    theme.colorMode.default === 'light'
      ? ''
      : `@media (prefers-color-scheme: dark) {\n${rule(':root:not([data-theme])', dark, 'dark')}\n}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The presets a reader may pick from the theme menu; empty when there is no
 * menu. A rule with `data-palette` outranks the site's own rule in the same
 * mode, and its dark form outranks them both, so these must come after the
 * site's own tokens. With every preset on offer this is over ten times the
 * size of those tokens, which is why a build ships it as one file the browser
 * keeps instead of repeating it in each document.
 */
export function themePaletteCss(theme: ThemeConfig): string {
  return theme.picker
    .filter((name) => name !== theme.preset)
    .flatMap((name) => [
      rule(
        `:root[data-palette='${name}']`,
        declarations({ ...lookTokens(THEME_PRESETS[name].look ?? {}), ...presetColors(name, 'light') }),
        'light',
      ),
      rule(`:root[data-palette='${name}'][data-theme='dark']`, declarations(presetColors(name, 'dark')), 'dark'),
    ])
    .join('\n')
}

/** Both in one stylesheet. The dev server uses this, and swaps it in place when a token changes. */
export function themeToCss(theme: ThemeConfig): string {
  return [themeBaseCss(theme), themePaletteCss(theme)].filter(Boolean).join('\n')
}

/**
 * The palettes in the reader's menu, with the three colours its swatch shows.
 * Empty when `theme.picker` is off.
 */
export function paletteChoices(theme: ThemeConfig): PaletteChoice[] {
  const { palettes } = codeThemePlan(theme)
  return theme.picker.map((name) => {
    const own = name === theme.preset
    const colors = own ? theme.colors : THEME_PRESETS[name].colors
    const swatch = (mode: Mode): [string, string, string] => [
      colors.background[mode],
      colors.accent[mode],
      colors.highlight[mode],
    ]
    return {
      name,
      label: THEME_PRESETS[name].label,
      swatch: { light: swatch('light'), dark: swatch('dark') },
      // The site's own entry is never listed as a look: picking it puts everything back.
      look: !own && THEME_PRESETS[name].look !== undefined,
      code: palettes[name] ?? ['light', 'dark'],
    }
  })
}

/**
 * Inline script that applies a reader's colour mode and palette before the
 * first paint, so there is no flash of the wrong theme. Kept tiny: it runs on
 * every page load. A stored palette that the site no longer offers is ignored.
 * With a palette it also sets `data-code`, the syntax theme that palette uses
 * in the current mode.
 */
export function colorModeScript(theme: Pick<ThemeConfig, 'colorMode' | 'picker' | 'preset' | 'code'>): string {
  const plan = codeThemePlan(theme)
  const offered = Object.fromEntries(
    theme.picker.filter((name) => name !== theme.preset).map((name) => [name, plan.palettes[name] ?? ['light', 'dark']]),
  )
  const palette = Object.keys(offered).length
    ? `var P=${JSON.stringify(offered)},p=localStorage.getItem('${PALETTE_KEY}');` +
      `if(p&&P.hasOwnProperty(p)){d.dataset.palette=p;d.dataset.code=P[p][m==='dark'?1:0]}`
    : ''
  return (
    `(function(){try{var d=document.documentElement,s=localStorage.getItem('${COLOR_MODE_KEY}');` +
    `var m=s==='light'||s==='dark'?s:${JSON.stringify(theme.colorMode.default)};` +
    `if(m==='system')m=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';` +
    `d.dataset.theme=m;${palette}}catch(e){}})()`
  )
}
