---
title: CLI
description: The shabd command and its options.
layout: reference
---

Every command takes the site folder as an optional argument. It defaults to the current folder.

| Command | What it does |
| --- | --- |
| `shabd dev [root]` | Starts the dev server |
| `shabd build [root]` | Builds the static site into `dist/` |
| `shabd preview [root]` | Serves `dist/`, including the MCP route |
| `shabd check [root]` | Validates the config, sidebar, frontmatter and internal links |
| `shabd mcp [root]` | Runs the docs MCP server over stdio |

## Options

| Option | Applies to | Effect |
| --- | --- | --- |
| `--port <number>` | `dev`, `preview` | Listen on this port |
| `--host [address]` | `dev`, `preview` | Listen on the network, not only on localhost |
| `--open` | `dev` | Open the browser when the server starts |
| `--no-semantic` | `build` | Skip embeddings and build keyword search only |
| `--adapter <host>` | `build` | Also write the [MCP endpoint](../features/mcp.md#in-production) as a function for `cloudflare`, `vercel` or `netlify` |
