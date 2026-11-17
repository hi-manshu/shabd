/**
 * Built-in themes.
 *
 * A preset is a palette: the twelve colour tokens in a light and a dark
 * mode, and a pair of code-highlighting themes that sit well with them.
 * `theme.preset` picks one, and anything under `theme.colors` or
 * `theme.code` is laid over it.
 *
 * A preset may also carry a look: fonts, corners, rules and some of the
 * optional colours. A site's own settings come before the look, and the look
 * before Shabd's defaults.
 *
 * Every palette is held to the same contrast floor by test/presets.test.ts:
 * 7:1 for text and 4.5:1 for muted text, links and callout titles, against
 * both the page and the surface colour.
 */
import { over, parseColor, toHex, type Rgba } from './color.js'

export interface ModeColor {
  light: string
  dark: string
}

/** The colours every palette defines. */
export const COLOR_TOKENS = [
  'accent',
  'highlight',
  'background',
  'surface',
  'text',
  'muted',
  'border',
  'note',
  'tip',
  'success',
  'caution',
  'danger',
] as const
export type ColorToken = (typeof COLOR_TOKENS)[number]

/**
 * Colours a site may set but no palette has to. Most fall back, in the
 * stylesheet, to one of the twelve: links to `accent`; headings, headline
 * bars and the primary button to `text`; the header and sidebar to
 * `background`; code to `surface`; the selection to `highlight`. The content
 * area (`main`) is see-through and the page has no `backdrop` until one is
 * set. `backdrop` is the odd one out: it takes any CSS background, such as a
 * gradient, and shows only through panels whose own colour is translucent.
 * `codeText` is the colour of code the syntax theme leaves uncoloured; left
 * unset, that code keeps the syntax theme's own foreground.
 */
export const OPTIONAL_COLOR_TOKENS = [
  'link',
  'heading',
  'bar',
  'button',
  'header',
  'sidebar',
  'main',
  'code',
  'codeText',
  'selection',
  'backdrop',
] as const
export type OptionalColorToken = (typeof OPTIONAL_COLOR_TOKENS)[number]

export const CORNERS = ['hang', 'round'] as const
export const CODE_FRAMES = ['bar', 'window', 'xp'] as const
export const HEADING_CASES = ['none', 'uppercase'] as const

/** Everything about a theme's shape that is not a colour. */
export interface Look {
  /** Font stacks for text and for code. */
  sans: string
  mono: string
  /** Font stack for titles and headings. Left out, they follow `sans`. */
  heading?: string
  /** `uppercase` sets titles and headings in capitals. */
  headingCase: (typeof HEADING_CASES)[number]
  /** Extra space between the letters of titles and headings, as a CSS length such as `0.04em`. */
  headingTracking: string
  /** Weight of body text, and of a second-level heading. */
  weight: number
  headingWeight: number
  /** Width of headings and of the largest titles, in percent. Only fonts with a width axis respond. */
  headingWidth: number
  displayWidth: number
  radius: string
  /** `hang`: flat on top, round underneath. `round`: round all the way. */
  corners: (typeof CORNERS)[number]
  /** Thickness of the rule above a code block, a card or a callout. */
  rule: string
  /** Thickness of every other border. */
  line: string
  /** A CSS box-shadow for panels and buttons: code blocks, callouts, the search field. */
  shadow: string
  /** Draw the heavy bar above page titles and the hero. */
  bars: boolean
  /**
   * `bar`: code hangs from a rule. `window`: code sits in a window with a title bar and its three buttons at the
   * left. `xp`: the window has a blue title bar, with the title at the left and the three buttons at the right.
   */
  codeFrame: (typeof CODE_FRAMES)[number]
}

/** The look of a site that names no preset and sets nothing. */
export const DEFAULT_LOOK: Look = {
  sans: '"Anek Latin Variable", ui-sans-serif, system-ui, sans-serif',
  mono: '"Red Hat Mono Variable", ui-monospace, "SF Mono", Menlo, monospace',
  headingCase: 'none',
  headingTracking: '0em',
  weight: 400,
  headingWeight: 700,
  headingWidth: 112,
  displayWidth: 125,
  radius: '8px',
  corners: 'hang',
  rule: '2px',
  line: '1px',
  shadow: 'none',
  bars: true,
  codeFrame: 'bar',
}

/* Font stacks for looks. Nothing is shipped: each name resolves only where that font is installed. */
const SYSTEM_MONO = '"SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace'
const BOOK_SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'

/** What a preset changes about the look, and the optional colours it sets. */
export interface PresetLook extends Partial<Look> {
  colors?: Partial<Record<OptionalColorToken, ModeColor>>
}

export interface ThemePreset {
  /** Name shown to readers in the theme menu. */
  label: string
  /** One line for the documentation. */
  description: string
  colors: Record<ColorToken, ModeColor>
  /** Shiki theme names. */
  code: ModeColor
  look?: PresetLook
}

type Palette = Record<ColorToken, string>

const preset = (
  label: string,
  description: string,
  light: Palette,
  dark: Palette,
  code: ModeColor,
  look?: PresetLook,
): ThemePreset => ({
  label,
  description,
  colors: Object.fromEntries(COLOR_TOKENS.map((token) => [token, { light: light[token], dark: dark[token] }])) as Record<
    ColorToken,
    ModeColor
  >,
  code,
  ...(look ? { look } : {}),
})

/** Callout colours that hold up on any near-white or near-black page. */
const CALLOUTS_LIGHT = { note: '#2563a8', tip: '#0c7a66', success: '#1a7a3c', caution: '#a8540a', danger: '#b8243a' }
const CALLOUTS_DARK = { note: '#8fbdf5', tip: '#6fd6bf', success: '#7ddc9c', caution: '#f5b267', danger: '#ff98a6' }

export const THEME_PRESETS = {
  shabd: preset(
    'Shabd',
    'Indigo ink with marigold marks. The default.',
    { accent: '#2b36a8', highlight: '#f6b40e', background: '#ffffff', surface: '#f3f4fa', text: '#1b1c3a', muted: '#5a5d7c', border: '#d9dbea', ...CALLOUTS_LIGHT },
    { accent: '#b3bbff', highlight: '#ffc53d', background: '#13142c', surface: '#1c1e3d', text: '#e8e9f5', muted: '#a3a6c6', border: '#2f3260', ...CALLOUTS_DARK },
    { light: 'github-light', dark: 'tokyo-night' },
  ),
  ink: preset(
    'Ink',
    'Black on white with one blue. For sites that want the theme out of the way.',
    { accent: '#1d4ed8', highlight: '#60a5fa', background: '#ffffff', surface: '#f4f4f5', text: '#111113', muted: '#5c5c66', border: '#dcdce0', ...CALLOUTS_LIGHT },
    { accent: '#8ab4ff', highlight: '#3b82f6', background: '#0e0e10', surface: '#19191d', text: '#ededf0', muted: '#a1a1ab', border: '#2e2e35', ...CALLOUTS_DARK },
    { light: 'github-light', dark: 'github-dark' },
  ),
  macos: preset(
    'macOS',
    'After the look of a macOS app: code in windows with a title bar, a frosted sidebar and header, the system font and system blue.',
    { accent: '#0066cc', highlight: '#007aff', background: '#ffffff', surface: '#f5f5f7', text: '#1d1d1f', muted: '#66666b', border: '#d2d2d7', note: '#0066cc', tip: '#0071a4', success: '#1d7a33', caution: '#c93400', danger: '#d70015' },
    { accent: '#2997ff', highlight: '#0a84ff', background: '#1e1e1e', surface: '#2c2c2e', text: '#f5f5f7', muted: '#a1a1a6', border: '#424245', note: '#409cff', tip: '#70d7ff', success: '#30d158', caution: '#ff9f0a', danger: '#ff6961' },
    { light: 'github-light-default', dark: 'github-dark-default' },
    {
      // No font is shipped: these names resolve to the system font where there is one.
      sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, "Segoe UI", sans-serif',
      mono: '"SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace',
      headingWeight: 600,
      headingWidth: 100,
      displayWidth: 100,
      radius: '10px',
      corners: 'round',
      rule: '1px',
      bars: false,
      codeFrame: 'window',
      colors: {
        // Separators instead of headline bars.
        bar: { light: '#d2d2d7', dark: '#424245' },
        button: { light: '#0071e3', dark: '#0a84ff' },
        selection: { light: '#b3d7ff', dark: '#3f638b' },
        // Plain code in the page's own ink, whatever syntax theme the site was built with.
        codeText: { light: '#1d1d1f', dark: '#f5f5f7' },
        // Frosted glass: the header and the sidebar are translucent and blur what is behind them,
        // which is a soft wallpaper kept to their side of the page. The content area stays solid.
        header: { light: 'rgb(255 255 255 / 0.72)', dark: 'rgb(30 30 30 / 0.7)' },
        sidebar: { light: 'rgb(246 246 248 / 0.74)', dark: 'rgb(38 38 42 / 0.78)' },
        main: { light: '#ffffff', dark: '#1e1e1e' },
        // Blues and a little aqua: one family of colour, so the frost reads as glass and not as decoration.
        backdrop: {
          light:
            'radial-gradient(46rem 34rem at 0% 8%, rgb(120 185 255 / 0.5), transparent 62%), radial-gradient(38rem 30rem at 8% 92%, rgb(120 215 225 / 0.38), transparent 62%)',
          dark:
            'radial-gradient(46rem 34rem at 0% 8%, rgb(30 95 200 / 0.5), transparent 62%), radial-gradient(38rem 30rem at 8% 92%, rgb(20 120 140 / 0.34), transparent 62%)',
        },
      },
    },
  ),
  xp: preset(
    'Windows XP',
    'After the look of Windows XP: code in windows with a blue title bar and its three buttons, cream panels, a pale blue side pane, a green button and Tahoma.',
    { accent: '#0046d5', highlight: '#f59b00', background: '#ffffff', surface: '#ece9d8', text: '#000000', muted: '#555555', border: '#7f9db9', note: '#0046d5', tip: '#00695c', success: '#1a6b2c', caution: '#8f4700', danger: '#b3171f' },
    { accent: '#8fc0ff', highlight: '#ffb84a', background: '#101a30', surface: '#1b2942', text: '#f1f5ff', muted: '#a9b6d2', border: '#40598a', ...CALLOUTS_DARK },
    // The colours of Visual Studio, which is where most people read code on that desktop.
    { light: 'light-plus', dark: 'dark-plus' },
    {
      // No font is shipped: Tahoma and Trebuchet MS are on Windows and macOS, and the rest stand in elsewhere.
      sans: 'Tahoma, Verdana, "Segoe UI", "DejaVu Sans", sans-serif',
      mono: '"Lucida Console", "Courier New", ui-monospace, monospace',
      heading: '"Trebuchet MS", Tahoma, Verdana, sans-serif',
      headingWeight: 700,
      headingWidth: 100,
      displayWidth: 100,
      radius: '3px',
      corners: 'round',
      rule: '3px',
      codeFrame: 'xp',
      colors: {
        // Title-bar blue for the headline bars, and the navy of a window's caption for headings.
        bar: { light: '#0a55dd', dark: '#3d86f5' },
        heading: { light: '#0a2a80', dark: '#dbe7ff' },
        // The green of the button in the corner of that desktop.
        button: { light: '#2b7a2b', dark: '#86d886' },
        selection: { light: '#b9d1f7', dark: '#2f5fa8' },
        // A toolbar above, and a task pane down the side. Both are solid: there is no wallpaper behind them.
        header: {
          light: 'linear-gradient(180deg, #fdfcf7, #ece9d8)',
          dark: 'linear-gradient(180deg, #1f2f4d, #17243d)',
        },
        sidebar: {
          light: 'linear-gradient(180deg, #dbe8fb, #c3d6f5)',
          dark: 'linear-gradient(180deg, #152748, #101d38)',
        },
      },
    },
  ),
  blueprint: preset(
    'Blueprint',
    'An engineer\'s drawing: a measured grid behind the page, capital headings in a typewriter face, square corners.',
    { accent: '#0b5cad', highlight: '#e09a00', background: '#f4f7fb', surface: '#e6edf6', text: '#0d2a4d', muted: '#47617f', border: '#b9c9dd', note: '#0b5cad', tip: '#0a6e5c', success: '#176d36', caution: '#964a08', danger: '#a81f34' },
    { accent: '#8fd3ff', highlight: '#ffd166', background: '#0c2340', surface: '#12305a', text: '#eaf2ff', muted: '#a9c1e6', border: '#2c4f80', note: '#9ccaff', tip: '#7fe3cf', success: '#8ee6a8', caution: '#ffc078', danger: '#ffa3ae' },
    { light: 'github-light', dark: 'night-owl' },
    {
      heading: SYSTEM_MONO,
      headingCase: 'uppercase',
      headingTracking: '0.03em',
      headingWeight: 600,
      headingWidth: 100,
      displayWidth: 100,
      radius: '0px',
      rule: '1px',
      colors: {
        bar: { light: '#0b5cad', dark: '#8fd3ff' },
        // Fine lines every 24px and a heavier one every 120px, like drafting paper.
        backdrop: {
          light:
            'linear-gradient(rgb(11 92 173 / 0.14) 1px, transparent 1px) 0 0 / 120px 120px, linear-gradient(90deg, rgb(11 92 173 / 0.14) 1px, transparent 1px) 0 0 / 120px 120px, linear-gradient(rgb(11 92 173 / 0.07) 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, rgb(11 92 173 / 0.07) 1px, transparent 1px) 0 0 / 24px 24px',
          dark:
            'linear-gradient(rgb(143 211 255 / 0.13) 1px, transparent 1px) 0 0 / 120px 120px, linear-gradient(90deg, rgb(143 211 255 / 0.13) 1px, transparent 1px) 0 0 / 120px 120px, linear-gradient(rgb(143 211 255 / 0.06) 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, rgb(143 211 255 / 0.06) 1px, transparent 1px) 0 0 / 24px 24px',
        },
        header: { light: 'rgb(244 247 251 / 0.8)', dark: 'rgb(12 35 64 / 0.8)' },
        sidebar: { light: 'rgb(244 247 251 / 0.6)', dark: 'rgb(12 35 64 / 0.6)' },
        // Half a wash over the grid where the text is, so no line crosses a letter at full strength.
        main: { light: 'rgb(244 247 251 / 0.58)', dark: 'rgb(12 35 64 / 0.5)' },
      },
    },
  ),
  newsprint: preset(
    'Newsprint',
    'A broadsheet: serif text on off-white paper, a heavy rule over every headline, one red.',
    { accent: '#8f1d1d', highlight: '#b3261e', background: '#f7f3ea', surface: '#ece5d6', text: '#1c1a17', muted: '#5e574b', border: '#cfc6b3', note: '#1f4f8f', tip: '#0a6558', success: '#1c6331', caution: '#8a4a0b', danger: '#9f1d2e' },
    { accent: '#f0a39a', highlight: '#e5534b', background: '#161412', surface: '#221f1b', text: '#efe9dc', muted: '#b5ab99', border: '#3a352d', note: '#9cc3f5', tip: '#7fd9c6', success: '#8fdc9f', caution: '#f2b872', danger: '#ff9d9d' },
    { light: 'vitesse-light', dark: 'vitesse-dark' },
    {
      sans: BOOK_SERIF,
      heading: '"Bodoni 72", Didot, "Playfair Display", Georgia, "Times New Roman", serif',
      headingWeight: 700,
      headingWidth: 100,
      displayWidth: 100,
      radius: '0px',
      rule: '1px',
    },
  ),
  brutal: preset(
    'Brutal',
    'Black lines, hard shadows and flat colour. Nothing is rounded and nothing is subtle.',
    { accent: '#1a3fd6', highlight: '#ff4f8b', background: '#ffffff', surface: '#f2f2f2', text: '#000000', muted: '#3d3d3d', border: '#000000', note: '#1a3fd6', tip: '#00664f', success: '#0b6b2b', caution: '#9a4a00', danger: '#c1121f' },
    { accent: '#ffd500', highlight: '#00e0ff', background: '#000000', surface: '#141414', text: '#ffffff', muted: '#c9c9c9', border: '#ffffff', note: '#8fb8ff', tip: '#6ff0d0', success: '#7df59b', caution: '#ffc266', danger: '#ff8c8c' },
    { light: 'github-light-high-contrast', dark: 'github-dark-high-contrast' },
    {
      sans: '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif',
      heading: '"Arial Black", "Archivo Black", "Helvetica Neue", Arial, sans-serif',
      headingWeight: 800,
      headingWidth: 100,
      displayWidth: 100,
      radius: '0px',
      rule: '3px',
      line: '2px',
      // The shadow is the text colour, so it turns white on the dark page.
      shadow: '4px 4px 0 var(--sb-text)',
      colors: {
        sidebar: { light: '#ffd500', dark: '#141414' },
        button: { light: '#1a3fd6', dark: '#ffd500' },
        selection: { light: '#ffd500', dark: '#1a3fd6' },
      },
    },
  ),
  aurora: preset(
    'Aurora',
    'Frosted panels under northern lights: green and blue light across a dark sky, and the page lets it through.',
    { accent: '#0f766e', highlight: '#0ea5e9', background: '#f6fbfa', surface: '#e7f3f1', text: '#0d2b2a', muted: '#456563', border: '#c5dedb', note: '#225ea3', tip: '#0b7462', success: '#187439', caution: '#a04f09', danger: '#b22237' },
    { accent: '#5eead4', highlight: '#7dd3fc', background: '#07141d', surface: '#0e2230', text: '#e9f7f4', muted: '#9dc0bd', border: '#1f3d4b', note: '#8ec9ff', tip: '#6fe3cf', success: '#86e6a2', caution: '#f7c26b', danger: '#ff9aa8' },
    { light: 'min-light', dark: 'night-owl' },
    {
      radius: '14px',
      corners: 'round',
      rule: '1px',
      bars: false,
      codeFrame: 'window',
      colors: {
        bar: { light: '#c5dedb', dark: '#1f3d4b' },
        backdrop: {
          light:
            'radial-gradient(60rem 30rem at 15% -5%, rgb(94 234 212 / 0.45), transparent 60%), radial-gradient(50rem 28rem at 85% 0%, rgb(125 211 252 / 0.42), transparent 62%), radial-gradient(70rem 36rem at 50% 105%, rgb(134 239 172 / 0.3), transparent 60%)',
          dark:
            'radial-gradient(60rem 30rem at 15% -5%, rgb(45 212 191 / 0.38), transparent 60%), radial-gradient(50rem 28rem at 85% 0%, rgb(56 189 248 / 0.3), transparent 62%), radial-gradient(70rem 36rem at 50% 105%, rgb(34 197 94 / 0.22), transparent 60%)',
        },
        header: { light: 'rgb(255 255 255 / 0.6)', dark: 'rgb(7 20 29 / 0.6)' },
        sidebar: { light: 'rgb(255 255 255 / 0.5)', dark: 'rgb(10 28 40 / 0.55)' },
        main: { light: 'rgb(255 255 255 / 0.72)', dark: 'rgb(7 20 29 / 0.78)' },
      },
    },
  ),
  cosmos: preset(
    'Cosmos',
    'A night sky: stars behind the page, a blue glow at its edges, and panels of dark glass.',
    { accent: '#1d4ed8', highlight: '#f59e0b', background: '#f5f8ff', surface: '#e8eefb', text: '#0f1a33', muted: '#4a5a7d', border: '#ccd7ee', note: '#225ea3', tip: '#0b7462', success: '#187439', caution: '#a04f09', danger: '#b22237' },
    { accent: '#8ecbff', highlight: '#ffd166', background: '#060913', surface: '#0e1424', text: '#e8eefc', muted: '#9fb0d0', border: '#1e2a44', note: '#8ecbff', tip: '#7fe3cf', success: '#8ee6a8', caution: '#ffc078', danger: '#ffa3ae' },
    { light: 'github-light', dark: 'night-owl' },
    {
      radius: '12px',
      corners: 'round',
      rule: '1px',
      bars: false,
      codeFrame: 'window',
      colors: {
        bar: { light: '#ccd7ee', dark: '#1e2a44' },
        backdrop: {
          // By day, a pale sky with a low sun.
          light:
            'radial-gradient(50rem 30rem at 85% 10%, rgb(147 197 253 / 0.5), transparent 60%), radial-gradient(40rem 26rem at 5% 95%, rgb(253 224 71 / 0.25), transparent 60%)',
          // By night, four layers of stars that repeat at different distances, over two glows.
          // The stars are dim on purpose. Not every browser blurs what is behind a panel, and
          // where one does not, a star sits right behind the text: it has to stay readable there.
          dark:
            'radial-gradient(1px 1px at 20px 30px, rgb(255 255 255 / 0.55) 50%, transparent 100%) 0 0 / 180px 180px, radial-gradient(1px 1px at 110px 80px, rgb(255 255 255 / 0.45) 50%, transparent 100%) 0 0 / 230px 230px, radial-gradient(1.5px 1.5px at 60px 150px, rgb(190 220 255 / 0.5) 50%, transparent 100%) 0 0 / 310px 310px, radial-gradient(1px 1px at 200px 40px, rgb(255 240 200 / 0.45) 50%, transparent 100%) 0 0 / 370px 370px, radial-gradient(50rem 30rem at 85% 10%, rgb(40 110 200 / 0.28), transparent 60%), radial-gradient(40rem 26rem at 5% 95%, rgb(20 130 150 / 0.2), transparent 60%)',
        },
        header: { light: 'rgb(255 255 255 / 0.6)', dark: 'rgb(6 9 19 / 0.66)' },
        sidebar: { light: 'rgb(255 255 255 / 0.5)', dark: 'rgb(10 14 28 / 0.64)' },
        main: { light: 'rgb(255 255 255 / 0.78)', dark: 'rgb(6 9 19 / 0.62)' },
      },
    },
  ),
  sunrise: preset(
    'Sunrise',
    'Warm glass: peach and gold light behind frosted panels, and its dusk after dark.',
    { accent: '#b4470b', highlight: '#f59e0b', background: '#fffaf3', surface: '#fcefdc', text: '#33200f', muted: '#75583d', border: '#f0d9bb', note: '#225ea3', tip: '#0b7462', success: '#187439', caution: '#9a4a08', danger: '#b22237' },
    { accent: '#ffb37a', highlight: '#ffc53d', background: '#1a0f0b', surface: '#281812', text: '#fbeee0', muted: '#cdb09a', border: '#45291d', note: '#9cc3f5', tip: '#7fd9c6', success: '#8fdc9f', caution: '#f7c26b', danger: '#ff9d9d' },
    { light: 'vitesse-light', dark: 'vesper' },
    {
      radius: '16px',
      corners: 'round',
      rule: '1px',
      bars: false,
      codeFrame: 'window',
      colors: {
        bar: { light: '#f0d9bb', dark: '#45291d' },
        button: { light: '#b4470b', dark: '#ffb37a' },
        backdrop: {
          light:
            'radial-gradient(60rem 34rem at 10% -10%, rgb(255 190 110 / 0.55), transparent 60%), radial-gradient(48rem 30rem at 95% 5%, rgb(255 150 120 / 0.4), transparent 62%), radial-gradient(60rem 30rem at 50% 110%, rgb(255 220 130 / 0.4), transparent 60%)',
          dark:
            'radial-gradient(60rem 34rem at 10% -10%, rgb(230 110 40 / 0.4), transparent 60%), radial-gradient(48rem 30rem at 95% 5%, rgb(200 60 50 / 0.3), transparent 62%), radial-gradient(60rem 30rem at 50% 110%, rgb(240 170 40 / 0.22), transparent 60%)',
        },
        header: { light: 'rgb(255 250 243 / 0.62)', dark: 'rgb(26 15 11 / 0.62)' },
        sidebar: { light: 'rgb(255 250 243 / 0.52)', dark: 'rgb(34 20 14 / 0.55)' },
        main: { light: 'rgb(255 255 255 / 0.74)', dark: 'rgb(26 15 11 / 0.8)' },
      },
    },
  ),
  zen: preset(
    'Zen',
    'Ink on paper: a serif face, hairlines in seal red, and nothing else.',
    { accent: '#a3261d', highlight: '#c8341f', background: '#f8f5ee', surface: '#eee9dd', text: '#1f1d1a', muted: '#635d52', border: '#d8d1c1', note: '#1f4f8f', tip: '#0a6558', success: '#1c6331', caution: '#8a4a0b', danger: '#9f1d2e' },
    { accent: '#f08a7b', highlight: '#e5533d', background: '#171614', surface: '#22201d', text: '#ece7dc', muted: '#aaa294', border: '#38342e', note: '#9cc3f5', tip: '#7fd9c6', success: '#8fdc9f', caution: '#f2b872', danger: '#ff9d9d' },
    { light: 'vitesse-light', dark: 'vitesse-dark' },
    {
      sans: '"Hiragino Mincho ProN", "Yu Mincho", "Iowan Old Style", Palatino, Georgia, serif',
      headingWeight: 600,
      headingWidth: 100,
      displayWidth: 100,
      headingTracking: '0.02em',
      radius: '2px',
      rule: '1px',
      bars: false,
      colors: {
        bar: { light: '#a3261d', dark: '#f08a7b' },
        // Plain code in the page's own ink.
        codeText: { light: '#1f1d1a', dark: '#ece7dc' },
      },
    },
  ),
  paper: preset(
    'Paper',
    'Warm off-white and brown ink, for long reading.',
    { accent: '#9a3412', highlight: '#d97706', background: '#fbf7ef', surface: '#f2ebdd', text: '#2b2418', muted: '#665841', border: '#e0d5bf', note: '#1f5a9e', tip: '#0a6e5c', success: '#176d36', caution: '#964a08', danger: '#a81f34' },
    { accent: '#f0a878', highlight: '#f59e0b', background: '#1c1813', surface: '#28221a', text: '#efe6d6', muted: '#b3a48b', border: '#3d3427', ...CALLOUTS_DARK },
    { light: 'gruvbox-light-medium', dark: 'gruvbox-dark-medium' },
  ),
  marigold: preset(
    'Marigold',
    'The default turned inside out: warm pages with indigo marks.',
    { accent: '#8a4b00', highlight: '#2b36a8', background: '#fffdf5', surface: '#fbf3d9', text: '#2a2110', muted: '#685830', border: '#ead9a6', note: '#1f5a9e', tip: '#0a6e5c', success: '#176d36', caution: '#964a08', danger: '#a81f34' },
    { accent: '#ffc53d', highlight: '#8f9af5', background: '#1a1508', surface: '#261f0d', text: '#f6edd3', muted: '#baa977', border: '#3f3415', ...CALLOUTS_DARK },
    { light: 'solarized-light', dark: 'solarized-dark' },
  ),
  forest: preset(
    'Forest',
    'Deep green with amber marks.',
    { accent: '#1f6f43', highlight: '#e0a526', background: '#fbfdf9', surface: '#eef4ea', text: '#16241a', muted: '#4c5d4f', border: '#d3dfcd', ...CALLOUTS_LIGHT },
    { accent: '#7fd69b', highlight: '#f0b93a', background: '#101a13', surface: '#18261c', text: '#e4efe3', muted: '#9cb09c', border: '#2a3d2e', ...CALLOUTS_DARK },
    { light: 'everforest-light', dark: 'everforest-dark' },
  ),
  mint: preset(
    'Mint',
    'Teal on a cool, pale green.',
    { accent: '#0f766e', highlight: '#10b981', background: '#f7fdfb', surface: '#e6f6f0', text: '#0f2a24', muted: '#44625a', border: '#c9e6dc', note: '#225ea3', tip: '#0b7462', success: '#187439', caution: '#a04f09', danger: '#b22237' },
    { accent: '#5eead4', highlight: '#34d399', background: '#0c1b18', surface: '#132822', text: '#e0f5ee', muted: '#94b8ad', border: '#214238', ...CALLOUTS_DARK },
    { light: 'min-light', dark: 'vitesse-dark' },
  ),
  ocean: preset(
    'Ocean',
    'Sea blue with coral marks.',
    { accent: '#0b6e8f', highlight: '#ff8a5b', background: '#f8fcfd', surface: '#e9f4f7', text: '#0f2530', muted: '#46606d', border: '#cfe2e8', note: '#225ea3', tip: '#0b7462', success: '#187439', caution: '#a04f09', danger: '#b22237' },
    { accent: '#6fd0ee', highlight: '#ff9b73', background: '#0b1a21', surface: '#12262f', text: '#e1f0f5', muted: '#93b0bb', border: '#21404c', ...CALLOUTS_DARK },
    { light: 'github-light', dark: 'night-owl' },
  ),
  slate: preset(
    'Slate',
    'Cool grey-blue, close to what most developer tools look like.',
    { accent: '#0369a1', highlight: '#38bdf8', background: '#f8fafc', surface: '#eef2f6', text: '#0f172a', muted: '#475569', border: '#d5dde7', note: '#225ea3', tip: '#0b7462', success: '#187439', caution: '#a04f09', danger: '#b22237' },
    { accent: '#7dd3fc', highlight: '#38bdf8', background: '#0f172a', surface: '#172033', text: '#e2e8f0', muted: '#94a3b8', border: '#2a3650', ...CALLOUTS_DARK },
    { light: 'github-light', dark: 'github-dark-dimmed' },
  ),
  grape: preset(
    'Grape',
    'Violet with lime marks.',
    { accent: '#6d28d9', highlight: '#84cc16', background: '#fbfaff', surface: '#f1eefc', text: '#1e1733', muted: '#5b5277', border: '#ddd6f3', ...CALLOUTS_LIGHT },
    { accent: '#c4a7ff', highlight: '#a3e635', background: '#141024', surface: '#1e1836', text: '#ebe7fa', muted: '#a89fc7', border: '#332a57', ...CALLOUTS_DARK },
    { light: 'catppuccin-latte', dark: 'catppuccin-mocha' },
  ),
  rose: preset(
    'Rose',
    'Deep pink with gold marks.',
    { accent: '#be185d', highlight: '#e8a317', background: '#fffafb', surface: '#fbeef1', text: '#2a1520', muted: '#714c5a', border: '#f1d5dd', note: '#225ea3', tip: '#0b7462', success: '#187439', caution: '#a04f09', danger: '#b22237' },
    { accent: '#ff8fb6', highlight: '#fbbf24', background: '#1c1016', surface: '#29171f', text: '#f7e6ec', muted: '#c39fae', border: '#45252f', ...CALLOUTS_DARK },
    { light: 'rose-pine-dawn', dark: 'rose-pine-moon' },
  ),
  sunset: preset(
    'Sunset',
    'Burnt orange with violet marks.',
    { accent: '#b83d0b', highlight: '#7c3aed', background: '#fffaf7', surface: '#fbeee6', text: '#2d1a1a', muted: '#70524b', border: '#f0d8cb', note: '#225ea3', tip: '#0b7462', success: '#187439', caution: '#a04f09', danger: '#b22237' },
    { accent: '#ff9d6c', highlight: '#a78bfa', background: '#1d1216', surface: '#2a1a20', text: '#f6e7e3', muted: '#c0a09b', border: '#44282f', ...CALLOUTS_DARK },
    { light: 'rose-pine-dawn', dark: 'rose-pine' },
  ),
  ember: preset(
    'Ember',
    'Charcoal and red.',
    { accent: '#b91c1c', highlight: '#f97316', background: '#fdfbfa', surface: '#f4efec', text: '#231815', muted: '#65524c', border: '#e4d8d2', ...CALLOUTS_LIGHT },
    { accent: '#ff8a7a', highlight: '#fb923c', background: '#171210', surface: '#221a17', text: '#f3e9e4', muted: '#b9a59d', border: '#3a2c27', ...CALLOUTS_DARK },
    { light: 'vitesse-light', dark: 'vesper' },
  ),
  terminal: preset(
    'Terminal',
    'A text terminal: one typewriter face for everything, green on black after dark, capital headings.',
    { accent: '#137a39', highlight: '#22c55e', background: '#f6fbf4', surface: '#e9f3e5', text: '#10240f', muted: '#435c3b', border: '#cfe0c7', note: '#225ea3', tip: '#0b7462', success: '#187439', caution: '#a04f09', danger: '#b22237' },
    { accent: '#4ade80', highlight: '#22c55e', background: '#050a06', surface: '#0d150e', text: '#c9f5c8', muted: '#7fae7d', border: '#1c3320', ...CALLOUTS_DARK },
    { light: 'min-light', dark: 'vitesse-black' },
    {
      sans: SYSTEM_MONO,
      mono: SYSTEM_MONO,
      headingCase: 'uppercase',
      headingWeight: 700,
      headingWidth: 100,
      displayWidth: 100,
      radius: '0px',
      rule: '1px',
      colors: {
        // Plain code is terminal text like everything else.
        codeText: { light: '#10240f', dark: '#c9f5c8' },
        // Faint scan lines, as on a tube display. Only in the dark mode.
        backdrop: {
          light: 'none',
          dark: 'repeating-linear-gradient(0deg, rgb(74 222 128 / 0.05) 0 1px, transparent 1px 3px)',
        },
      },
    },
  ),
  contrast: preset(
    'High contrast',
    'Pure black and white with the strongest borders and colours.',
    { accent: '#0000c8', highlight: '#b86e00', background: '#ffffff', surface: '#f0f0f0', text: '#000000', muted: '#333333', border: '#6b6b6b', note: '#0b3d91', tip: '#00594c', success: '#0a5c2a', caution: '#7a3b00', danger: '#8f1023' },
    { accent: '#9ecbff', highlight: '#ffd400', background: '#000000', surface: '#141414', text: '#ffffff', muted: '#d0d0d0', border: '#8a8a8a', note: '#a8d1ff', tip: '#8ff0dc', success: '#98f0b4', caution: '#ffc98a', danger: '#ffb3bd' },
    { light: 'github-light-high-contrast', dark: 'github-dark-high-contrast' },
  ),
} satisfies Record<string, ThemePreset>

/** Where a reader's choices are kept in their browser. The inline script in the page head reads both. */
export const COLOR_MODE_KEY = 'shabd-theme'
export const PALETTE_KEY = 'shabd-palette'

export type PresetName = keyof typeof THEME_PRESETS
export const PRESET_NAMES = Object.keys(THEME_PRESETS) as [PresetName, ...PresetName[]]
export const DEFAULT_PRESET: PresetName = 'shabd'

/* ─────────────────────────── syntax themes ─────────────────────────── */

export interface CodeThemePlan {
  /** Shiki theme names, without repeats. The site's own light and dark themes come first. */
  themes: string[]
  /** The key each theme goes by on the page: `light`, `dark`, then `t2`, `t3` and so on. */
  keys: string[]
  /** For each preset a reader may pick: the keys of the themes it uses in the light and the dark mode. */
  palettes: Record<string, [light: string, dark: string]>
}

/**
 * Code is highlighted once, at build time, in every syntax theme a reader
 * could end up seeing: the site's own two, and the pair of each preset in the
 * theme menu. Presets that share a syntax theme share its key.
 */
export function codeThemePlan(theme: { preset: string; picker: readonly string[]; code: ModeColor }): CodeThemePlan {
  const themes = [theme.code.light, theme.code.dark]
  const keyAt = (index: number) => (index === 0 ? 'light' : index === 1 ? 'dark' : `t${index}`)
  const keyOf = (name: string) => {
    const known = themes.indexOf(name)
    return keyAt(known >= 0 ? known : themes.push(name) - 1)
  }
  const palettes: CodeThemePlan['palettes'] = {}
  for (const name of theme.picker) {
    const preset = (THEME_PRESETS as Record<string, ThemePreset>)[name]
    palettes[name] = name === theme.preset || !preset ? ['light', 'dark'] : [keyOf(preset.code.light), keyOf(preset.code.dark)]
  }
  return { themes, keys: themes.map((_, index) => keyAt(index)), palettes }
}

type AnyColors = Partial<Record<ColorToken | OptionalColorToken, ModeColor>>

/**
 * How strongly a highlighted line is tinted with the palette's `highlight`.
 * The stylesheet draws it (`--sb-highlight-soft` in base.css); a test keeps
 * the two numbers equal.
 */
export const LINE_HIGHLIGHT_STRENGTH = 0.3

/** What code is drawn on, for each syntax theme of a plan and in the same order. */
export interface CodeBackgrounds {
  /** The code background of every palette that uses the theme, in the mode it uses it in. */
  code: string[][]
  /** The same under a highlighted line, which has a tint of the palette's `highlight` over it. */
  highlighted: string[][]
}

/**
 * The colours code is drawn on. Token colours are held to a contrast floor
 * against these (`theme.code.minContrast`): tokens on a highlighted line
 * against the tinted background, the rest against the plain one.
 *
 * Only colours that can be read without a browser count (see color.ts). A
 * palette whose code background cannot be read adds nothing, and the syntax
 * theme's colours are then left as they are for it.
 */
export function codeBackgrounds(theme: {
  preset: string
  picker: readonly string[]
  code: ModeColor
  colors: AnyColors
}): CodeBackgrounds {
  const plan = codeThemePlan(theme)
  const code = plan.keys.map(() => new Set<string>())
  const highlighted = plan.keys.map(() => new Set<string>())
  // Without a menu the plan lists no palette, and the site's own is the only one.
  const palettes: CodeThemePlan['palettes'] = theme.picker.length ? plan.palettes : { [theme.preset]: ['light', 'dark'] }

  for (const [name, keys] of Object.entries(palettes)) {
    const preset = (THEME_PRESETS as Record<string, ThemePreset>)[name]
    const colors: AnyColors = name === theme.preset || !preset ? theme.colors : { ...preset.colors, ...preset.look?.colors }
    ;(['light', 'dark'] as const).forEach((mode, slot) => {
      // Bottom to top: the page, the content area where it has a colour, the code block.
      let seen: Rgba | undefined
      for (const layer of [colors.background?.[mode], colors.main?.[mode], (colors.code ?? colors.surface)?.[mode]]) {
        if (layer === undefined) continue
        const colour = parseColor(layer)
        seen = !colour ? undefined : colour[3] === 1 ? colour : seen && over(colour, seen)
      }
      const index = plan.keys.indexOf(keys[slot]!)
      if (!seen || index < 0) return
      code[index]!.add(toHex(seen))
      const tint = parseColor(colors.highlight?.[mode] ?? '')
      if (tint) highlighted[index]!.add(toHex(over([tint[0], tint[1], tint[2], tint[3] * LINE_HIGHLIGHT_STRENGTH], seen)))
    })
  }
  return { code: code.map((found) => [...found]), highlighted: highlighted.map((found) => [...found]) }
}

/* ───────────────────────────── contrast ───────────────────────────── */

/** Relative luminance of a `#rrggbb` colour, as WCAG 2 defines it. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (lighter + 0.05) / (darker + 0.05)
}
