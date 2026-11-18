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

### On the page

A reader who works with an assistant can get to that copy from the page itself. Under the title of every `doc` and
`api` page is a row with three things:

| | What it does |
| --- | --- |
| Copy page | Puts the page's Markdown on the clipboard |
| View as Markdown | Opens the Markdown copy |
| Open in Claude, Open in ChatGPT | Opens the assistant with a prompt that asks it to read the page |

The assistant fetches the page from the network, so the last two are only shown when `site.url` is set, and they
lead somewhere useful only once the site is deployed there. They are links to other companies' sites, whose
addresses can change.

The row is the `page-actions` [block](../configuration/layouts.md#blocks). To change it, pass it options where the
layout places it:

```yaml title="shabd.config.yaml"
layouts:
  doc:
    regions:
      main:
        - breadcrumbs
        - page-header
        - block: page-actions
          props:
            assistants:
              - { label: Claude, url: "https://claude.ai/new?q={prompt}" }
            prompt: "Read {url} and summarise it."
        - content
        - page-footer
        - pagination
```

| Option | Default | Meaning |
| --- | --- | --- |
| `copy` | `true` | Show "Copy page" |
| `view` | `true` | Show "View as Markdown" |
| `assistants` | Claude and ChatGPT | A list of `{ label, url }`. `{prompt}` in the `url` is replaced by the prompt. An empty list shows none |
| `prompt` | `Read {url} so that I can ask questions about it.` | What the assistant is asked. `{url}` is replaced by the address of the Markdown copy |

Leave the block out of a layout to remove the row. It is also left out when `features.llms` is off, since the
Markdown copies are then not written.

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

For Cloudflare, Vercel and Netlify, an adapter writes the function along with the build:

```sh
npx shabd build --adapter cloudflare   # or vercel, or netlify
```

The host runs the function for the MCP route and for nothing else. It reads two JSON files that the build writes,
`_shabd/docs.json` and `_shabd/search-index.json`, from the site's own files. [Deploying](../guide/deploying.md)
says what each adapter writes and how to deploy it.

On any other host, mount the handler yourself in a serverless or edge function. It is a function from a `Request`
to a `Response`, it keeps no session, and it reads the same two files.

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
> The handler is tested with the official MCP client, and `shabd preview` serves it. The function each adapter
> writes is tested by loading it and calling it the way its host does. None of them has been deployed to
> Cloudflare, Vercel or Netlify, or to any other platform.

Search through a function on a host is keyword search, with an adapter and without. The next section says why.

### Search by meaning

`search_docs` ranks the way the site's own [search](./search.md) does. With semantic search on, a question finds
the section that answers it without sharing a word with it.

That takes the embedding model, so it depends on what serves the endpoint.

| Served by | `search_docs` matches |
| --- | --- |
| `shabd dev` | Keywords and meaning |
| `shabd mcp` | Keywords and meaning |
| `shabd preview` | Keywords and meaning, when the build wrote vectors |
| A function on a host, from an adapter or your own | Keywords |

The three commands are processes that stay, so they can hold the model. Each loads it once, the first time
something searches, and uses the one the index was built with. A function on a host starts and stops with its
requests, and would have to load the 22 MB model again each time it starts.

Nothing more has to be set up. It works where the reader's semantic search does: `features.search.semantic` is on
and `@huggingface/transformers` is installed, and for `shabd preview` the build was not run with `--no-semantic`.
When one of those is missing, the endpoint searches by keyword. When the model is wanted and cannot be loaded, it
searches by keyword too, and says why once in the terminal. No request fails for it.

What it costs, measured with `shabd preview` on a laptop, on this site's build of 130 sections: the first search
took 0.7 seconds and later ones about 15 milliseconds, and the process grew from 148 MB to 254 MB. `shabd dev` and
`shabd mcp` read the content folder, so their first search also embeds the sections that the cache does not hold
yet. After a build that is none of them. On a site that has never been built it is all of them.

To keep the endpoint to keywords and leave the reader's search as it is:

```yaml
features:
  mcp: { semantic: false }
```

`shabd mcp` and `shabd preview` then never load the model. `shabd dev` still loads it, for the reader's search.

A Node server of your own can do what `shabd preview` does. `staticDocs` reads a build, and with `semantic` it
reads the vectors as well and loads the model when the first search arrives:

```ts
import { staticDocs } from '@himanshoe/shabd'
import { createMcpHandler } from '@himanshoe/shabd/mcp'

const docs = await staticDocs('dist', { semantic: { root: process.cwd() } })
const handle = createMcpHandler(docs)
```

`root` is the site folder, where `@huggingface/transformers` is installed.

## Turning it off

```yaml
features:
  mcp: false
  llms: false
```
