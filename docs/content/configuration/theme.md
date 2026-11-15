---
title: Theme
description: Colours, type and widths are tokens in YAML. The stylesheet only reads them.
---

The `theme` section of `shabd.config.yaml` is a set of tokens. Shabd turns them into CSS custom properties, and its
stylesheet uses nothing else: no colour, font or size is written into the CSS itself.

```yaml title="shabd.config.yaml"
theme:
  colorMode:
    default: system
    toggle: true
  colors:
    accent: { light: "#2b36a8", dark: "#b3bbff" }
    highlight: "#f6b40e"
  typography:
    scale: 1.2
  radius: 8px
```

In `shabd dev`, saving a token change updates the page without a reload.

## Colour mode

| Key | Default | Meaning |
| --- | --- | --- |
| `colorMode.default` | `system` | `system` follows the reader's device. `light` and `dark` fix the first visit |
| `colorMode.toggle` | `true` | Show the switch in the header |

The reader's choice is remembered in their browser. The mode is applied before the first paint, so a page does not
flash in the wrong colours.

## Colours

Each colour is one value for both modes, or `{ light, dark }`.

| Token | Used for |
| --- | --- |
| `accent` | Links and focus rings |
| `highlight` | Marks: the bar on the current page, selected text, highlighted code lines |
| `background` | The page |
| `surface` | Code blocks, inline code, hovered items |
| `text` | Body text, and the bars that titles and code blocks hang from |
| `muted` | Secondary text |
| `border` | Lines between regions |
| `note`, `tip`, `success`, `caution`, `danger` | Callouts and badges |

## Typography

| Key | Default | Meaning |
| --- | --- | --- |
| `sans` | Anek Latin, then system fonts | Font stack for text |
| `mono` | Red Hat Mono, then system fonts | Font stack for code |
| `baseSize` | `16px` | Size of body text |
| `scale` | `1.2` | Ratio between one heading size and the next |
| `lineHeight` | `1.65` | Line height of body text |

Heading sizes come from the scale: each step is the previous one multiplied by `scale`. Raise it for more contrast
between headings, lower it for a flatter page.

The two default fonts ship inside Shabd and are served from your own site, so no request goes to a font service. If
you set a stack that does not name them, their files are left out of the build.

## Widths and corners

| Key | Default |
| --- | --- |
| `layout.contentWidth` | `46rem` |
| `layout.sidebarWidth` | `17rem` |
| `layout.tocWidth` | `14rem` |
| `layout.headerHeight` | `3.75rem` |
| `radius` | `8px` |

## Code

`code.light` and `code.dark` name the [Shiki themes](https://shiki.style/themes) used for syntax colours. The
defaults are `github-light` and `tokyo-night`. Both are applied when the site is built, and the colour mode picks
between them with CSS.

## Your own CSS

List stylesheets under `theme.css`. They load after the theme.

```yaml
theme:
  css: ./styles/custom.css
```

Every token is available as a custom property named `--sb-` plus the token: `--sb-accent`, `--sb-surface`,
`--sb-font-mono`, `--sb-radius`, `--sb-content-width`. The type scale is `--sb-step--1` (small) to `--sb-step-6`.

```css title="styles/custom.css"
.announcement {
  background: var(--sb-text);
  color: var(--sb-background);
  font-size: var(--sb-step--1);
}
```

Shabd's own rules sit in a cascade layer named `shabd`. Rules outside a layer take precedence over rules inside one,
so yours win over the theme's without `!important` and without matching its selectors.
