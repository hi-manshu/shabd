---
title: Theme
description: Pick a built-in palette, then change any colour, font or width in YAML. The stylesheet only reads these tokens.
---

The `theme` section of `shabd.config.yaml` is a set of tokens. Shabd turns them into CSS custom properties, and its
stylesheet uses nothing else: no colour, font or size is written into the CSS itself.

```yaml title="shabd.config.yaml"
theme:
  preset: forest
  picker: [ink, paper]
  colors:
    accent: { light: "#1f6f43", dark: "#7fd69b" }
  typography:
    heading: Georgia, serif
  corners: round
```

In `shabd dev`, saving a token change updates the page without a reload.

## Presets

`preset` names one of the built-in themes. Each has a light and a dark mode, and a pair of code themes that go
with it. This site has the [menu](#a-theme-menu-for-readers) turned on, so you can try each one from the header.

Ten presets are themes: they change fonts, corners and how code is framed as well as colour.

| Preset | Look |
| --- | --- |
| `macos` | After the look of a macOS app: code in windows with a title bar, a frosted sidebar and header, the system font and system blue |
| `xp` | After the look of Windows XP: code in windows with a blue title bar and its three buttons, cream panels, a pale blue side pane, a green button and Tahoma |
| `blueprint` | An engineer's drawing: a measured grid behind the page, capital headings in a typewriter face, square corners |
| `newsprint` | A broadsheet: serif text on off-white paper, a heavy rule over every headline, one red |
| `brutal` | Black lines, hard shadows and flat colour. Nothing is rounded and nothing is subtle |
| `aurora` | Frosted panels under northern lights: green and blue light across a dark sky, and the page lets it through |
| `cosmos` | A night sky: stars behind the page, a blue glow at its edges, and panels of dark glass |
| `sunrise` | Warm glass: peach and gold light behind frosted panels, and its dusk after dark |
| `zen` | Ink on paper: a serif face, hairlines in seal red, and nothing else |
| `terminal` | A text terminal: one typewriter face for everything, green on black after dark, capital headings |

The other thirteen are palettes. They change colour and leave the rest of the look alone.

| Preset | Colours |
| --- | --- |
| `shabd` | Indigo ink with marigold marks. The default |
| `ink` | Black on white with one blue. For sites that want the theme out of the way |
| `paper` | Warm off-white and brown ink, for long reading |
| `marigold` | The default turned inside out: warm pages with indigo marks |
| `forest` | Deep green with amber marks |
| `mint` | Teal on a cool, pale green |
| `ocean` | Sea blue with coral marks |
| `slate` | Cool grey-blue, close to what most developer tools look like |
| `grape` | Violet with lime marks |
| `rose` | Deep pink with gold marks |
| `sunset` | Burnt orange with violet marks |
| `ember` | Charcoal and red |
| `contrast` | Pure black and white with the strongest borders and colours |

A test holds every preset to the same floor: body text has a contrast of at least 7:1, and muted text, links and
callout titles at least 4.5:1, against both the page and the surface colour.

Comparing one colour with another is not enough for a theme that puts a picture behind the page, because what is
behind the text there is not one colour. A second test renders a page in each of the ten themes, light and dark,
in Chromium, Firefox and WebKit. It holds body text, muted text and the accent colour to the same ratios against
every pixel of the header, the sidebar and the content area.

That test looks at one page in a window of 1280 by 800, and it does not look inside code blocks or callouts, which
have backgrounds of their own. Neither test checks colours you set yourself. Code has a floor of its own, which
does apply to your colours: see [Code](#code).

Whatever you write under `colors` or `code` is laid over the preset, one token at a time.

A theme's look is made of settings you could write yourself. `macos`, for example:

- `code.frame: window` puts each code block in a window, with a title bar, the three window buttons and a shadow.
- The `sidebar` and `header` colours are translucent, so they blur what is behind them like frosted glass. A
  `backdrop` of soft colour sits behind the page to give them something to blur, and `main` keeps the content area
  solid in front of it.
- `button` makes the primary button blue, `bar` turns the headline bars into hairlines, and `bars: false` leaves
  page titles bare.
- `codeText` draws plain code in the page's own ink, so it stays neutral whichever syntax theme is in use.
- The font stacks name the system font, with `radius: 10px`, `corners: round` and `rule: 1px`.

`brutal` uses `line: 2px` and a hard `shadow`, `blueprint` uses `headingCase: uppercase` and a grid for its
`backdrop`, `xp` uses `code.frame: xp` and a gradient for its `header` and its `sidebar`, and so on. Every one of
these is in the tables below.

No font is shipped for any theme. Each font stack names fonts that come with an operating system, and falls back
to the platform's own serif, sans-serif or monospace face where they are missing. `macos` is San Francisco on Apple
devices; `newsprint` sets its headlines in Bodoni or Didot there and in Georgia elsewhere; `xp` is Tahoma and
Trebuchet MS where they are installed, and Verdana or the system's sans-serif where they are not. The window
buttons of `macos` and `xp` are pictures and do nothing.

For each of those settings, what you write comes first, then the preset's look, then the defaults in the tables
below.

## A theme menu for readers

`picker` adds a menu to the header where a reader can change the palette.

```yaml
theme:
  picker: true # every preset
```

```yaml
theme:
  picker: [ink, paper, contrast] # only these, after the site's own
```

The site's own palette is always the first entry. The choice is kept in the reader's browser and applied before the
first paint on their next visit.

A preset picked from the menu is the preset as it ships. Colours you set under `colors` belong to your own palette
and do not carry over to the others. A theme brings its fonts, corners and code frame with it; a palette leaves the
site's as they are. When the menu offers both kinds, it lists them under "Themes" and "Palettes".

Code follows the choice. A preset from the menu shows code in its own pair of syntax themes, and the site's own
entry shows the pair you set under [`code`](#code).

The menu makes pages with code heavier. Each page carries the colours of its own code in every syntax theme the
menu can reach, once in its HTML and once in its script. This site offers all twenty-three presets, which use 27
syntax themes between them: its page with the most code carries about 39 KB of those colours in each, a little
over 5 KB compressed. A page with no code carries none.

Without a menu a page carries two syntax themes, and each preset on the menu adds at most two. If page weight
matters to you, list the presets you want under `picker` and leave `picker: true` alone.

The presets' own colours are not repeated in every page. A build puts them in one stylesheet that every page
shares: about 40 KB here, about 5 KB compressed.

The menu is the `theme-menu` block, so a [layout](./layouts.md) can move it or leave it out.

## Colour mode

| Key | Default | Meaning |
| --- | --- | --- |
| `colorMode.default` | `system` | `system` follows the reader's device. `light` and `dark` fix the first visit |
| `colorMode.toggle` | `true` | Show the switch in the header |

The reader's choice is remembered in their browser. The mode is applied before the first paint, so a page does not
flash in the wrong colours.

## Colours

Each colour is one value for both modes, or `{ light, dark }`. A preset defines these twelve:

| Token | Used for |
| --- | --- |
| `accent` | Links and focus rings |
| `highlight` | Marks: the bar on the current page, highlighted code lines, the bar on a primary button |
| `background` | The page |
| `surface` | Code blocks, inline code, hovered items |
| `text` | Body text |
| `muted` | Secondary text |
| `border` | Lines between regions |
| `note`, `tip`, `success`, `caution`, `danger` | Callouts and badges |

Eleven more are optional. Most take their value from one of the twelve until you set them:

| Token | Used for | Until set |
| --- | --- | --- |
| `link` | Links in prose | `accent` |
| `heading` | Page titles and headings | `text` |
| `bar` | The bars that titles, code blocks, cards and buttons hang from | `text` |
| `button` | Background of a primary button. Its label is drawn in `background` | `text` |
| `header` | Background of the header | `background` |
| `sidebar` | Background of the sidebar | `background` |
| `main` | Background of the content area, the outline beside it and the footer | See-through |
| `code` | Background of code, inline and in blocks | `surface` |
| `codeText` | Code that the syntax theme leaves uncoloured, such as plain text | The syntax theme's own colour |
| `selection` | Background of selected text | A tint of `highlight` |
| `backdrop` | A picture behind the whole page: any CSS background, such as a gradient | None |

Text in the header and the sidebar keeps using `text` and `muted`. If you give either a background of its own,
choose one that those stay readable on, in both modes. Both are drawn as backgrounds, so a gradient works as well
as a colour: `xp` uses one for each.

A `header` or `sidebar` colour with some transparency, such as `rgb(255 255 255 / 0.7)`, blurs whatever is behind
it. The header always has the page scrolling under it. The sidebar has only the page's background, so it needs a
`backdrop` to look frosted, and then `main` to keep that backdrop out from under the text.

## Typography

| Key | Default | Meaning |
| --- | --- | --- |
| `sans` | Anek Latin, then system fonts | Font stack for text |
| `mono` | Red Hat Mono, then system fonts | Font stack for code |
| `heading` | The same as `sans` | Font stack for titles and headings |
| `headingCase` | `none` | `uppercase` sets titles and headings in capitals |
| `headingTracking` | `0em` | Extra space between the letters of titles and headings, such as `0.04em` |
| `baseSize` | `16px` | Size of body text |
| `scale` | `1.2` | Ratio between one heading size and the next |
| `lineHeight` | `1.65` | Line height of body text |
| `weight` | `400` | Weight of body text |
| `headingWeight` | `700` | Weight of a second-level heading |
| `headingWidth` | `112` | Width of headings, in percent of the font's normal width |
| `displayWidth` | `125` | Width of the site title, page titles and the hero |

Heading sizes come from the scale: each step is the previous one multiplied by `scale`. Raise it for more contrast
between headings, lower it for a flatter page.

Heading weights move together. A page title is 50 heavier than `headingWeight` and the hero title 80 heavier, while
third-level headings and below are 50 lighter.

The two widths only do something in a font that has a width axis. Anek Latin has one. In a font without it they are
ignored.

The two default fonts ship inside Shabd and are served from your own site, so no request goes to a font service. If
you set a stack that does not name them, their files are left out of the build. To use another font, declare its
`@font-face` in [your own CSS](#your-own-css) and name it in the stack.

## Widths, corners and rules

| Key | Default | Meaning |
| --- | --- | --- |
| `layout.contentWidth` | `46rem` | The text column of a `doc` page |
| `layout.wideWidth` | `68rem` | The main column of a `splash` page |
| `layout.sidebarWidth` | `17rem` | |
| `layout.tocWidth` | `14rem` | |
| `layout.headerHeight` | `3.75rem` | |
| `radius` | `8px` | How round corners are |
| `corners` | `hang` | `hang` rounds only the bottom corners, so a block looks hung from its bar. `round` rounds all four |
| `rule` | `2px` | Thickness of the bar above a code block, a card or a callout |
| `line` | `1px` | Thickness of every other border |
| `shadow` | `none` | A CSS `box-shadow` for panels and buttons: code blocks, callouts, the search field |
| `bars` | `true` | Draw the heavy bar above page titles and the hero. `false` leaves titles bare |

## Code

| Key | Default | Meaning |
| --- | --- | --- |
| `code.light`, `code.dark` | The preset's pair | [Shiki themes](https://shiki.style/themes) for syntax colours |
| `code.frame` | `bar` | `bar` hangs a code block from a rule. `window` puts it in a window with a title bar and its buttons at the left. `xp` gives the window a blue title bar, with the buttons at the right |
| `code.lineNumbers` | `false` | Number the lines of every code block |
| `code.wrap` | `false` | Wrap long lines in every code block instead of scrolling |
| `code.minContrast` | `4.5` | The least contrast a syntax colour may have against what is behind it. `0` leaves the syntax themes as they ship |

Both syntax themes are applied when the site is built, and the colour mode picks between them with CSS. With a
[theme menu](#a-theme-menu-for-readers), so are the syntax themes of the presets on it.

A syntax theme is drawn for a background of its own, and on a Shabd page the background of code belongs to the
palette. Some pairings leave a theme's fainter colours hard to read: Everforest Light's yellow has a contrast of
2.05:1 on the code background of the `forest` preset. So when the site is built, each syntax colour is measured
against the code background of every palette that can show it, and a colour on a highlighted line against that
line's tint. A colour below `code.minContrast` is made darker on a light background, or lighter on a dark one, by
the smallest step that reaches it. Its hue is kept, and a colour that already passes is not touched.

A test holds every preset to 4.5:1 in both modes, on a sample of code in eight languages. With your own colours
the measuring only works for hex and `rgb()` values. If `surface` or `code` is something else, such as `oklch()`,
the syntax colours are left as they ship for your palette; if `highlight` is, a highlighted line is measured
without its tint. `codeText` is your colour, and is not changed.

A single block can go against the site-wide setting with `noLineNumbers` or `noWrap` after its language, and can
ask for either with `showLineNumbers` or `wrap`. See [code blocks](../guide/writing/markdown.md#code-blocks).

## Your own CSS

List stylesheets under `theme.css`. They load after the theme.

```yaml
theme:
  css: ./styles/custom.css
```

Every token is available as a custom property named `--sb-` plus the token: `--sb-accent`, `--sb-surface`,
`--sb-bar`, `--sb-font-heading`, `--sb-radius`, `--sb-content-width`. The type scale is `--sb-step--1` (small) to
`--sb-step-6`.

```css title="styles/custom.css"
.announcement {
  background: var(--sb-text);
  color: var(--sb-background);
  font-size: var(--sb-step--1);
}
```

Shabd's own rules sit in a cascade layer named `shabd`. Rules outside a layer take precedence over rules inside one,
so yours win over the theme's without `!important` and without matching its selectors.
