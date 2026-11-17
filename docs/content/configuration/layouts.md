---
title: Layouts
description: A layout is a list of regions and the blocks inside them. Edit one, or define your own, in YAML.
---

Shabd has no layout components. A layout is data: for each region of the page, an ordered list of blocks. The three
layouts that ship with Shabd are defined in exactly the form you would write yourself.

```yaml
doc:
  extends: base
  width: content
  regions:
    sidebar: [sidebar-nav]
    main: [breadcrumbs, page-header, page-actions, content, page-footer, pagination]
    aside: [toc]
```

A page picks a layout with `layout:` in its [frontmatter](./frontmatter.md). Pages that do not pick one use
`defaults.layout`, which is `doc`.

## Regions

A page has up to six regions. A region with no blocks is not rendered, and the page's grid closes up around it.

| Region | Where it is |
| --- | --- |
| `banner` | Across the top, above the header |
| `header` | The bar that stays at the top of the window |
| `sidebar` | The left column. A slide-down panel on narrow screens |
| `main` | The content column |
| `aside` | The right column. Hidden on narrow screens |
| `footer` | Below the content |

## Blocks

| Block | Region it is made for | What it shows |
| --- | --- | --- |
| `menu-toggle` | header | Opens the sidebar on narrow screens |
| `site-title` | header | Logo and site name |
| `nav` | header | The links from `site.nav` |
| `spacer` | header | Empty space that pushes later blocks to the far edge |
| `search` | header | The search field |
| `studio-toggle` | header | Opens the [Studio](../features/studio.md). Dev server only |
| `social` | header | The links from `site.social` |
| `theme-menu` | header | The palette menu, when [`theme.picker`](./theme.md#a-theme-menu-for-readers) is on |
| `theme-toggle` | header | Light and dark switch |
| `sidebar-nav` | sidebar | The [sidebar](./sidebar.md) |
| `breadcrumbs` | main | The sidebar groups above this page |
| `page-header` | main | Title, badges and description |
| `page-actions` | main | [The page as Markdown](../features/mcp.md#on-the-page): copy it, open it, hand it to an assistant |
| `api-endpoint` | main | The request line from `api:` frontmatter |
| `hero` | main | The opening of a splash page, from `hero:` frontmatter |
| `content` | main | The Markdown body |
| `page-footer` | main | "Edit this page", and the day the page was [last changed](./site.md#when-a-page-was-last-changed) |
| `pagination` | main | Previous and next page |
| `toc` | aside | "On this page" |
| `footer` | footer | The text from `site.footer` |

Any block can go in any region. A block name Shabd does not know is an error when the config loads, with the list of
names that exist.

## The built-in layouts

| Layout | Width | Regions |
| --- | --- | --- |
| `base` | | `header`, `footer`. The other three extend it |
| `doc` | `content` | adds `sidebar`, `main` and `aside` |
| `splash` | `wide` | adds `main` with `hero` and `content` |
| `api` | `full` | adds `sidebar` and `main` with `api-endpoint`. No `aside`. Sets [prose beside code](#prose-beside-code) |

`width` sets how wide the main column may grow: `content` is the reading width from the
[theme](./theme.md), `wide` is 68rem, and `full` has no limit.

## Edit a built-in layout

Name the layout under `layouts:` and list the regions you want to change. Regions you leave out stay as they are.

```yaml title="shabd.config.yaml"
layouts:
  doc:
    regions:
      # No "Edit this page" and no previous/next links
      main: [breadcrumbs, page-header, page-actions, content]
```

Every built-in layout extends `base`, so a change to `base` shows on every page. This site adds its announcement bar
that way:

```yaml
layouts:
  base:
    regions:
      banner: [announcement]
```

## Define a new layout

Give it a name, and start from an existing layout with `extends`. This site defines `reference`, a wider `doc` with
no outline. The [CLI page](../reference/cli.md) uses it.

```yaml
layouts:
  reference:
    extends: doc
    width: wide
    regions:
      aside: []
```

```md
---
title: CLI
layout: reference
---
```

A new layout that does not say `extends` starts empty, with no header.

## Pass options to a block

Write a block as an object to give it `props`.

```yaml
regions:
  aside:
    - block: toc
      props: { title: Contents }
```

`toc` takes `title`, `search` takes `label`, and `page-actions` takes
[the options listed with it](../features/mcp.md#on-the-page). Your own blocks receive whatever you pass.

## Show a block on some pages only

A block written as an object can carry a condition, `when`. The block is then part of the layout only on the pages
that meet it.

```yaml title="shabd.config.yaml"
layouts:
  base:
    regions:
      banner:
        - block: announcement
          when:
            path: /guide/**
```

| Key | Meaning |
| --- | --- |
| `path` | A pattern the page's address must match, or a list of them. `*` stands for one part of a path and `**` for any number, so `/guide/**` is every page under `/guide`, and `/guide` itself. A pattern that starts with `!` takes pages away again |
| `frontmatter` | Values the page's frontmatter must have. Every key listed must equal the page's value |

```yaml
when:
  path: ["/**", "!/blog/**"] # everywhere but the blog
  frontmatter: { beta: true } # and only on pages that say `beta: true`
```

With both keys, both must hold. A region whose blocks are all left out is not drawn, as with any other region
that has nothing in it.

## Prose beside code

A layout with `split: true` sets a page's code samples beside its text on a screen wide enough for both. The page
is cut into rows at its headings; in each row the text is on the left and the code on the right, and the code stays
in view while the text beside it is read. On a narrow screen the code follows the text.

The built-in `api` layout does this. The [llms.txt endpoint](../reference/endpoints/llms-txt.md) page shows it. To
have it on a layout of your own, or to take it off `api`:

```yaml title="shabd.config.yaml"
layouts:
  reference:
    extends: doc
    width: full
    split: true
  api:
    split: false
```

A page with no code is left as one column. Only fenced code, [sandboxes](../features/sandbox.mdx) and
[diagrams](../guide/writing/markdown.md#diagrams) go to the right; tables, callouts and pictures stay with the
text.

## Your own blocks

A block is a React component. Register it by name, then use the name in a layout.

```yaml title="shabd.config.yaml"
blocks:
  announcement: ./components/Announcement.tsx
```

```tsx title="components/Announcement.tsx"
import { useSite } from '@himanshoe/shabd/client'

export default function Announcement({ message }: { message?: string }) {
  const { site } = useSite()
  return <p className="announcement">{message ?? `${site.title} is pre-release software.`}</p>
}
```

`useSite()` returns the site data and `usePage()` returns the current page: its path, title, frontmatter and outline.
A block registered under a built-in block's name replaces it.

## What a page can switch off

A layout says what a kind of page has. A single page can still remove parts of it from its frontmatter:

| Frontmatter | Effect |
| --- | --- |
| `sidebar: false` | Removes the `sidebar` region |
| `toc: false` | Removes the `toc` block, and the `aside` region if that leaves it empty |
| `pagination: false` | Removes the `pagination` block |
| `editLink: false` | Hides the link in `page-footer` |
