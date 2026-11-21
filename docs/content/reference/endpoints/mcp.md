---
title: MCP endpoint
description: The Model Context Protocol endpoint every Shabd site can serve.
layout: api
api:
  method: POST
  path: /mcp
  auth: none
badges: [Beta]
---

The endpoint speaks the Model Context Protocol over Streamable HTTP. It is stateless: each request is answered on its
own, and no session is kept.

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `search_docs` | `query`, `limit` | The best-matching sections, with page paths |
| `read_page` | `path` | One page as Markdown |
| `list_pages` | none | Every page with its title and description |

## Where it is served

The path is `features.mcp.route`, under `site.base`.

| Served by | Where | `search_docs` matches |
| --- | --- | --- |
| `shabd dev` | The dev server | Keywords and meaning |
| `shabd preview` | Beside `dist/` | Keywords and meaning, when the build wrote vectors |
| `shabd mcp` | stdio, with no address | Keywords and meaning |
| `shabd build --adapter` | A function on Cloudflare, Vercel or Netlify | Keywords |

Matching by meaning needs [semantic search](../../features/search.md) to be on for the site.
[MCP and llms.txt](../../features/mcp.md#search-by-meaning) says when it is used and what it costs, and
[Deploying](../../guide/deploying.md) what the adapters write.
