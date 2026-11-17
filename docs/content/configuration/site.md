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
# yaml-language-server: $schema=./node_modules/@himanshoe/shabd/schemas/config.schema.json
```

## site

| Key | Default | Meaning |
| --- | --- | --- |
| `title` | required | Shown in the header and in page titles |
| `description` | empty | Default meta description, and the summary in `llms.txt` |
| `url` | none | The deployed origin, such as `https://docs.example.com`. Needed for canonical URLs, `sitemap.xml` and absolute links in `llms.txt` |
| `base` | `/` | The path the site is served from, such as `/docs/` |
| `lang` | `en` | The `lang` attribute of every page |
| `logo` | none | A path to an image, or the [settings below](#logo) |
| `favicon` | none | A path to an icon in `public/` |
| `repo` | none | A repository URL, or `{ url, branch, dir }`. Enables "Edit this page" |
| `social` | none | `{ github: https://… }`, or a list of `{ icon, href, label }` |
| `nav` | none | Header links: a list of `{ label, link, badge }` |
| `footer` | none | Text for the page footer |
| `head` | none | Tags for the `<head>` of every page: see [head tags](#head-tags) |
| `noindex` | `false` | Ask search engines not to list any page of the site: see [search engines](#search-engines) |
| `robots` | see below | `false`, or `{ disallow: [/drafts/] }`: see [search engines](#search-engines) |

### Logo

A path on its own is one image for both colour modes. To give each mode its own image, or to change how the logo
sits in the header, write the settings out:

```yaml title="shabd.config.yaml"
site:
  logo:
    light: /logo-light.svg
    dark: /logo-dark.svg
    height: 2rem
    replacesTitle: true
```

| Key | Default | Meaning |
| --- | --- | --- |
| `src` | none | One image for both colour modes |
| `light`, `dark` | none | An image for each colour mode. Give both, or `src` |
| `alt` | empty | Text for screen readers. Leave it empty while the title is shown beside the logo |
| `height` | `1.75rem` | Height in the header. The width follows from the image, and the logo is kept inside the header |
| `href` | `/` | Where the logo and the title link to: a page path or a URL |
| `replacesTitle` | `false` | Show the logo without the site title beside it. The title becomes the image's `alt` unless you set one |

The files go in `public/`. Any format a browser shows as an image works, and an SVG may carry its own animation.

### Head tags

`head` is a list of tags that Shabd writes into the `<head>` of every page, after its own. It is where an analytics
script, a search engine's verification tag or a preconnect goes.

```yaml title="shabd.config.yaml"
site:
  head:
    - tag: meta
      attrs: { name: google-site-verification, content: abc123 }
    - tag: script
      attrs: { src: https://stats.example.com/script.js, defer: true, data-domain: docs.example.com }
    - tag: script
      content: window.queue = window.queue || []
```

| Key | Meaning |
| --- | --- |
| `tag` | `meta`, `link`, `script`, `style` or `noscript` |
| `attrs` | The tag's attributes. `true` writes an attribute with no value, such as `defer`, and `false` leaves it out |
| `content` | What goes inside a `script`, a `style` or a `noscript` |

A `href` or `src` that starts with `/` is a path inside the site, and gets `site.base` in front of it like every
other path in the config.

The tags are written by `shabd dev` as well as by a build. An analytics script therefore counts your own visits
while you write, unless the script leaves `localhost` out by itself.

### Search engines

With `site.url` set, a build writes `sitemap.xml`, which lists every page, and gives each page its canonical
address.

It also writes `robots.txt`, which lets every crawler in and names the sitemap. Crawlers read that file at the root
of a host and nowhere else, so a site served from a sub-path (`base: /docs/`) gets one only if `robots` is set. A
`robots.txt` of your own in `public/` is used instead of the generated one.

```yaml title="shabd.config.yaml"
site:
  robots:
    disallow: [/drafts/, /internal/] # paths crawlers should stay out of
```

`robots: false` writes no file.

To keep pages out of search results, use `noindex`. On the site it covers every page, which suits a staging copy or
a preview of a pull request. In a page's [frontmatter](./frontmatter.md) it covers that page.

```yaml title="shabd.config.yaml"
site:
  noindex: true
```

A page that is `noindex` carries a tag that says so and is left out of the sitemap. It is not added to
`robots.txt`: a crawler that may not fetch a page never sees the tag, and can still list the bare address. The page
stays in the site's own search, in the sidebar and in `llms.txt`.

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

## redirects

When a page moves, list its old address here. A reader who follows an old link or a bookmark then arrives at the
new one.

```yaml title="shabd.config.yaml"
redirects:
  /guide/setup: /guide/installation
  /guide/faq: /guide/introduction#questions
  /blog: https://example.com/blog
```

The key is the address that moved. The value is a page, with a `#heading` if you want one, or a full address on
another site. One redirect may lead to another: the reader is sent straight to where the last one ends.

A static host cannot answer with a redirect, so a build writes a small page at the old address that sends the
reader on, with or without JavaScript. It tells search engines where the content went, and asks them not to list
the old address. `shabd dev` answers with a redirect of its own.

Mistakes are reported in three places:

- Redirects that lead to each other in a circle are an error when the config loads.
- `shabd check` and the build report a redirect that leads to a page that does not exist, and one whose old address
  still has a page.
- They also warn about a link in your content that points at an address that has moved, so that you can link to
  the new one.

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
