---
title: Site configuration
description: Every key of shabd.config.yaml.
toc: { maxDepth: 2 }
---

`shabd.config.yaml` sits in the site folder. Only `site.title` is required; everything else has a default.

```yaml title="shabd.config.yaml"
site:
  title: My docs
```

## Mistakes are reported in the file

The config is checked when it loads. Unknown keys are errors, not silently ignored, and each problem points at the
line and column it came from:

```text
Invalid configuration (2 problems)

shabd.config.yaml:3:3  site.descripton
  Unknown key "descripton". Did you mean "description"?

  1 | site:
  2 |   title: My docs
  3 |   descripton: Guides for the Acme API
    |   ^
  4 | theme:

shabd.config.yaml:6:14  theme.colorMode.default
  Invalid option: expected one of "system"|"light"|"dark"

  4 | theme:
  5 |   colorMode:
  6 |     default: night
    |              ^
  7 | layouts:
```

In `shabd dev` the same report appears in the browser, and goes away when the file is fixed.

To get completion and validation while you type, point your editor's YAML language server at the schema that ships
with Shabd:

```yaml title="shabd.config.yaml"
# yaml-language-server: $schema=./node_modules/shabd/schemas/config.schema.json
```

## site

| Key | Default | Meaning |
| --- | --- | --- |
| `title` | required | Shown in the header and in page titles |
| `description` | empty | Default meta description, and the summary in `llms.txt` |
| `url` | none | The deployed origin, such as `https://docs.example.com`. Needed for canonical URLs, `sitemap.xml` and absolute links in `llms.txt` |
| `base` | `/` | The path the site is served from, such as `/docs/` |
| `lang` | `en` | The `lang` attribute of every page |
| `logo` | none | A path, or `{ light, dark, alt }` |
| `favicon` | none | A path to an icon in `public/` |
| `repo` | none | A repository URL, or `{ url, branch, dir }`. Enables "Edit this page" |
| `social` | none | `{ github: https://… }`, or a list of `{ icon, href, label }` |
| `nav` | none | Header links: a list of `{ label, link, badge }` |
| `footer` | none | Text for the page footer |

## content

| Key | Default | Meaning |
| --- | --- | --- |
| `dir` | `content` | The folder of pages |
| `sidebar` | `sidebar.yaml` | The [sidebar file](./sidebar.md) |

## defaults

These apply to every page. A page's [frontmatter](./frontmatter.md) overrides them.

| Key | Default | Meaning |
| --- | --- | --- |
| `layout` | `doc` | The layout for pages that do not name one |
| `toc` | `{ minDepth: 2, maxDepth: 3 }` | Which heading levels appear under "On this page" |
| `editLink` | `true` | Show "Edit this page" (needs `site.repo`) |
| `pagination` | `true` | Show previous and next links |

## features

Each feature takes `true`, `false`, or an object of options.

| Key | Options | Default |
| --- | --- | --- |
| `search` | `enabled`, `semantic`, `model`, `maxResults`, `minSimilarity`, `store` | on, with semantic search, in memory |
| `mcp` | `enabled`, `route` | on, at `/mcp` |
| `llms` | `enabled`, `full` | on, with `llms-full.txt` |
| `studio` | `enabled`, `sync` (`off`, `tabs` or `peers`) | on, syncing between tabs |
| `sandbox` | `enabled` | on |

```yaml
features:
  search: { semantic: false } # keyword search only
  studio: false
```

Each feature has its own page: [Search](../features/search.md), [MCP and llms.txt](../features/mcp.md),
[Studio](../features/studio.md) and [Live sandboxes](../features/sandbox.mdx).

## components and blocks

Both map a name to a file. `components` are available in every `.mdx` page; `blocks` can be placed in
[layouts](./layouts.md#your-own-blocks).

```yaml
components:
  Counter: ./components/Counter.tsx
blocks:
  announcement: ./components/Announcement.tsx
```

Component names are PascalCase and block names are kebab-case. A path that does not exist is an error.

The other two sections have their own pages: [theme](./theme.md) and [layouts](./layouts.md).
