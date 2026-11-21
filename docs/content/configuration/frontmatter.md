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
| `date` | a day | The day the page was published, such as `2026-11-17`. [The feed](../features/feed.md) lists the page under it |
| `draft` | `true` | Visible in `shabd dev`, left out of builds |
| `noindex` | `true` | Asks [search engines](./site.md#search-engines) not to list the page. It stays in the site's own search |
| `editLink` | `false` | Hide "Edit this page" |
| `pagination` | `false` | Hide previous and next links |
| `lastUpdated` | a day, or `false` | The day shown as [last updated](./site.md#when-a-page-was-last-changed), such as `2026-11-17`, in place of the one Git has. `false` shows none |
| `image` | a path or an address | The [picture](../features/social-images.md) other sites show when the page is shared |
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
  path: /v1/users/{id}/notes
  baseUrl: https://api.example.com
  auth: Bearer token
  deprecated: false
  try: true
  body:
    text: Hello
```

| Key | What it does |
| --- | --- |
| `method` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` or `OPTIONS`. Required |
| `path` | The path of the request. Required. A part in braces, `{id}`, is a parameter and is marked as one. So is a segment that starts with a colon, `:id` |
| `baseUrl` | The address of the API, shown in front of the path |
| `auth` | How a caller signs in, in words: `Bearer token`, `none` |
| `deprecated` | `true` marks the request as one not to use any more |
| `try` | `true` lets a reader [send the request](#trying-a-request) from the page |
| `body` | A body for the reader's request to start from, written as YAML |

### Trying a request

With `try: true` the request line has a **Try it** button. It opens a form with the address of the API, a field for
each parameter of the path, a query, headers and, for a request that carries one, a body. **Send** sends the request
and shows what the API answered: the status, how long it took, and the answer itself. The
[llms.txt endpoint](../reference/endpoints/llms-txt.md) page has one that fetches this site's own file.

The request is sent by the reader's browser, straight to the API. A Shabd site is static files, so there is no
server of its own for a request to pass through, and nothing the reader types reaches the docs site. That decides
what works:

- **The API has to allow requests from other sites.** A browser only gives a page the answer when the API sends
  `Access-Control-Allow-Origin` for the address of the docs. Before a request with a body, or with a header such as
  `Authorization`, the browser first asks the API with an `OPTIONS` request, and the API has to answer that too. When
  it does not, the form says the request got no answer. A browser does not tell a page why.
- **The requests are real.** A `DELETE` deletes. Offer `try` where a reader can do no harm, or point `baseUrl` at
  a sandbox.
- **A body is sent as JSON.** `body` is written as YAML and shown to the reader as JSON, to change before sending.
  One that is not JSON is not sent, and the form says what is wrong with it. Form fields and file uploads are not
  supported.
- **Headers are typed one to a line**, as `Authorization: Bearer …`. A browser does not let a page set some of
  them, `Cookie` and `Origin` among them, and leaves those out without saying so.
- **The answer is shown when it is text.** JSON is laid out to be read. Up to 100,000 characters are shown. For
  anything else the form gives its type and its size. The headers of the answer are not shown. A request that is
  not answered in 30 seconds is given up.

The address and the headers a reader types are kept while they move between the pages of one API, so a token is
typed once. They are held in memory and never stored: reloading the page forgets them. Pages share them when they
have the same `baseUrl`, so a token typed for one API is not offered to another.

Without `baseUrl` the reader types the address of the API themselves.
