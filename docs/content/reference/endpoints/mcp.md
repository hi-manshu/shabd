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
