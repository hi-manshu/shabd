---
title: MCP and llms.txt
description: Three ways an AI agent can read a Shabd site, from a static file to a live endpoint.
---

A coding agent that needs your documentation has to get it as text. Shabd publishes the site in three forms for
that, in increasing order of capability.

## Markdown copies of every page

Each page is also written as Markdown, at its own address with `.md` added. The home page is `/index.md`.

```text
/guide/installation      the page
/guide/installation.md   the same page as Markdown
```

Frontmatter and MDX `import` lines are removed. The rest is the Markdown you wrote.

## llms.txt

`/llms.txt` follows the [llms.txt convention](https://llmstxt.org): a short Markdown file that lists every page with
its description and links to the Markdown copy. Pages are grouped the way [the sidebar](../configuration/sidebar.md)
groups them.

`/llms-full.txt` is every page's Markdown in one file, in sidebar order.

Both are generated. Set `site.url` so that their links are absolute.

```yaml
features:
  llms: { full: false } # write llms.txt but not llms-full.txt
```

## The MCP endpoint

The [Model Context Protocol](https://modelcontextprotocol.io) lets an agent call tools. A Shabd site offers three,
all read-only:

| Tool | What it returns |
| --- | --- |
| `search_docs` | The best-matching sections for a query, each with its page path and an excerpt |
| `read_page` | One page as Markdown |
| `list_pages` | Every page with its path, title and description |

Pages are also listed as MCP resources.

### While you write

`shabd dev` serves the endpoint at `/mcp`. It reads the files on disk, so an agent sees your edits as you make them.

```sh
claude mcp add --transport http my-docs http://localhost:5173/mcp
```

In dev the endpoint refuses requests that come from other websites. Tools on your machine can still call it.

### Without a server

`shabd mcp` runs the same server over stdio, straight from the content folder. Nothing has to be running first.

```sh
claude mcp add my-docs -- npx shabd mcp ./docs
```

### In production

`shabd build` writes a static site, and static hosts only answer `GET`. The MCP endpoint answers `POST`, so it needs
something that runs code.

`shabd preview` is that for a local check: it serves `dist/` and the endpoint together.

For a site on Cloudflare Pages, Vercel or Netlify, an adapter writes the code that runs, where the host looks for
it. Deploying the site then deploys the endpoint:

```sh
npx shabd build --adapter cloudflare
```

| Adapter | What it writes |
| --- | --- |
| `cloudflare` | `dist/_worker.js`, a Worker for Pages, and `dist/_routes.json`, which asks Pages to run it for `/mcp` only. Publish `dist/` as usual |
| `vercel` | `.vercel/output/`, in Vercel's Build Output format: the site under `static/` and the endpoint as a function with the Edge runtime |
| `netlify` | `.netlify/v1/edge-functions/shabd-mcp.js`, which Netlify reads after the build command. The publish directory stays `dist` |

The function is one file of about 390 KB with nothing left to install. It reads `_shabd/docs.json` and
`_shabd/search-index.json` from the deployed site on its first request, and keeps them for as long as the host
keeps it warm. With `site.base` set, the endpoint is at `mcp` under that path.

> [!WARNING] Not yet deployed to a host
> Each adapter's function is run in Shabd's tests the way its host runs it: with the built site's files beside it,
> and with generating code from strings forbidden, as Cloudflare forbids it. None has been deployed to its host
> yet. `.vercel/` and `.netlify/` are build output: keep them out of Git.

On any other host, or if an adapter does not suit, mount the handler yourself. It is a function from a `Request`
to a `Response`, it keeps no session, and it reads the same two JSON files.

```ts
import { createMcpHandler, staticDocsFrom } from '@himanshoe/shabd/mcp'

const origin = 'https://docs.example.com'
const [docs, index] = await Promise.all([
  fetch(`${origin}/_shabd/docs.json`).then((response) => response.json()),
  fetch(`${origin}/_shabd/search-index.json`).then((response) => response.json()),
])

const handle = createMcpHandler(staticDocsFrom(docs, index))

export default { fetch: (request: Request) => handle(request) }
```

Search through a deployed endpoint is keyword search. The semantic ranking needs the embedding model, which a small
function should not have to load.

## Turning it off

```yaml
features:
  mcp: false
  llms: false
```
