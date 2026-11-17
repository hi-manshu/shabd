---
title: Markdown
description: The Markdown features Shabd supports, and what each one renders as.
toc: { maxDepth: 2 }
---

Shabd reads GitHub Flavored Markdown. Files ending in `.md` and `.mdx` go through the same pipeline; `.mdx` files can
also use components.

## Headings

Every heading gets an id made from its text, and a link that appears when you hover over it. The headings between the
levels set by `toc` appear under "On this page".

## Callouts

Write a callout as a GitHub alert. The five types are `NOTE`, `TIP`, `IMPORTANT`, `WARNING` and `CAUTION`.

```md
> [!WARNING] Back up first
> This command rewrites files in place.
```

> [!NOTE]
> A note holds information the reader should not miss.

> [!TIP]
> A tip suggests a better way to do something.

> [!IMPORTANT]
> Important callouts hold what the reader needs in order to succeed.

> [!WARNING] Back up first
> Text after the type becomes the title.

> [!CAUTION]
> A caution warns about consequences that are hard to undo.

## Code blocks

Code is highlighted when the site is built, so no highlighter is sent to the browser. Options go after the language:

````md
```ts title="src/greet.ts" {2} showLineNumbers
export function greet(name: string) {
  return `Hello, ${name}`
}
```
````

```ts title="src/greet.ts" {2} showLineNumbers
export function greet(name: string) {
  return `Hello, ${name}`
}
```

| Option | Effect |
| --- | --- |
| `title="…"` | Shows a file name above the code |
| `{2,4-6}` | Highlights those lines |
| `showLineNumbers` | Numbers the lines |
| `wrap` | Wraps long lines instead of scrolling |
| `noLineNumbers`, `noWrap` | Turn either off for this block when [the theme](../../configuration/theme.md#code) turns it on for all |

## Links

Link to other pages by their file path, as you would on GitHub. Shabd rewrites the link to the page's address.

```md
[Installation](../installation.md)
```

## Tables, task lists and footnotes

| Syntax | Renders as |
| --- | --- |
| `- [x] Done` | A checked task |
| `~~text~~` | ~~Struck through~~ |
| `[^1]` | A footnote reference[^1] |

- [x] Write the page
- [ ] Publish it

[^1]: Footnotes are collected at the end of the page.
