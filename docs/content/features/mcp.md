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

For a deployed site, the handler is exported for you to mount in a serverless or edge function. It is a function
from a `Request` to a `Response`, it keeps no session, and it reads two JSON files that the build writes.

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

> [!WARNING] Not yet tested on a host
> The handler is tested with the official MCP client, and `shabd preview` serves it. Deploying it to a particular
> platform has not been tested, and there are no ready-made adapters yet.

Search through a deployed endpoint is keyword search. The semantic ranking needs the embedding model, which a small
function should not have to load.

## Turning it off

```yaml
features:
  mcp: false
  llms: false
```
