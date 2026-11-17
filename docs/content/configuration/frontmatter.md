---
title: Frontmatter
description: The YAML at the top of a page that picks its layout and switches parts of it on and off.
badges: [Stable]
---

Frontmatter is a block of YAML between two `---` lines at the top of a page. Every key is optional.

```md
---
title: Installation
description: Create a site and run it.
layout: doc
sidebar: false
toc: { maxDepth: 4 }
badges: [Beta]
---

The page starts here.
```

## Keys

| Key | Type | What it does |
| --- | --- | --- |
| `title` | text | The page title. See [where a title comes from](../guide/project-structure.md#where-a-pages-title-comes-from) |
| `description` | text | Shown under the title, and used as the meta description |
| `layout` | name | `doc`, `splash`, `api`, or [a layout you defined](./layouts.md) |
| `sidebar` | `false` or options | Hide the sidebar on this page, or set this page's sidebar entry |
| `toc` | `false`, a number, or `{ minDepth, maxDepth }` | The "On this page" outline |
| `badges` | list | Badges beside the title |
| `draft` | `true` | Visible in `shabd dev`, left out of builds |
| `noindex` | `true` | Asks [search engines](./site.md#search-engines) not to list the page. It stays in the site's own search |
| `editLink` | `false` | Hide "Edit this page" |
| `pagination` | `false` | Hide previous and next links |
| `lastUpdated` | a day, or `false` | The day shown as [last updated](./site.md#when-a-page-was-last-changed), such as `2026-11-17`, in place of the one Git has. `false` shows none |
| `hero` | options | Content for the `splash` layout |
| `api` | options | Content for the `api` layout |

You can add keys of your own. Shabd ignores them, and your components can read them from `usePage().frontmatter`.

A mistake in one of the keys above is reported with its line and column. In `shabd dev` the report replaces the
page's content, the rest of the site stays usable, and the page comes back when the file is fixed. A build stops.

## layout

The layout decides which regions the page has. This page uses `doc`, the default.

```yaml
layout: splash
```

A name that does not exist is an error that lists the layouts that do.

## sidebar

`false` hides the sidebar on this page. An object sets the page's own entry instead.

```yaml
sidebar: false
```

```yaml
sidebar:
  visible: true # the sidebar itself, on this page
  label: Install # this page's label in the sidebar
  order: 2
  badge: New
  exclude: false
```

## toc

By default the outline lists `##` and `###` headings. A number sets the deepest level; an object sets both ends.

```yaml
toc: 4 # ## to ####
toc: { minDepth: 2, maxDepth: 2 } # ## only
toc: false # no outline
```

When no heading falls in the range, the outline is left out and the page takes the space.

## badges

Badges appear beside the title. This page has one. They follow the same rules as
[sidebar badges](./sidebar.md#badges).

```yaml
badges:
  - New
  - { text: v2, variant: note }
```

## hero

Used by `layout: splash`. `title` defaults to the page title and `tagline` to the description.

```yaml
layout: splash
hero:
  title: Documentation, configured in YAML
  tagline: Point Shabd at a folder of Markdown.
  image: /hero.svg
  actions:
    - { label: Read the guide, link: /guide/introduction }
    - { label: View source, link: https://github.com/your-org/your-repo, variant: secondary }
```

## api

Used by `layout: api` to draw the request line. The [MCP endpoint](../reference/endpoints/mcp.md) page is an example.

```yaml
layout: api
api:
  method: POST
  path: /v1/users/{id}
  baseUrl: https://api.example.com
  auth: Bearer token
  deprecated: false
```
