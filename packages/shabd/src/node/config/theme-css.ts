/**
 * Theme tokens (YAML) → CSS custom properties.
 *
 * The stylesheet in src/client/styles never names a colour or a size; it only
 * reads these variables. Changing the look of a site is a YAML edit.
 */
import type { ModeColor, ThemeConfig } from '../../shared/schema.js'

/** Steps of the modular scale exposed as `--sb-step-N`. */
const SCALE_STEPS = [-2, -1, 0, 1, 2, 3, 4, 5, 6] as const

function declarations(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `  --sb-${name}: ${value};`)
    .join('\n')
}

function colorVars(colors: ThemeConfig['colors'], mode: keyof ModeColor): Record<string, string> {
  return Object.fromEntries(Object.entries(colors).map(([name, value]) => [name, value[mode]]))
}

export function themeToCss(theme: ThemeConfig): string {
  const { typography, layout } = theme

  const scale = Object.fromEntries(
    SCALE_STEPS.map((step) => [`step-${step}`, `${Number(typography.scale ** step).toFixed(3)}rem`]),
  )

  const base = declarations({
    'font-sans': typography.sans,
    'font-mono': typography.mono,
    'font-size': typography.baseSize,
    'line-height': String(typography.lineHeight),
    ...scale,
    radius: theme.radius,
    'content-width': layout.contentWidth,
    'sidebar-width': layout.sidebarWidth,
    'toc-width': layout.tocWidth,
    'header-height': layout.headerHeight,
  })

  const light = declarations(colorVars(theme.colors, 'light'))
  const dark = declarations(colorVars(theme.colors, 'dark'))

  // `data-theme` is set before first paint by the inline script in the HTML
  // shell. The media query covers visitors with JavaScript disabled.
  return [
    `:root {\n${base}\n${light}\n  color-scheme: light;\n}`,
    `:root[data-theme='dark'] {\n${dark}\n  color-scheme: dark;\n}`,
    theme.colorMode.default === 'light'
      ? ''
      : `@media (prefers-color-scheme: dark) {\n:root:not([data-theme]) {\n${dark}\n  color-scheme: dark;\n}\n}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Inline script that picks the colour mode before the first paint, so there
 * is no flash of the wrong theme. Kept tiny: it runs on every page load.
 */
export function colorModeScript(defaultMode: ThemeConfig['colorMode']['default']): string {
  return (
    `(function(){try{var s=localStorage.getItem('shabd-theme');` +
    `var m=s==='light'||s==='dark'?s:${JSON.stringify(defaultMode)};` +
    `if(m==='system')m=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';` +
    `document.documentElement.dataset.theme=m}catch(e){}})()`
  )
}
