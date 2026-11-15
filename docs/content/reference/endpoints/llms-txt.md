---
title: llms.txt
description: The plain-text map of the site, for language models.
layout: api
api:
  method: GET
  path: /llms.txt
  auth: none
sidebar:
  order: 1
---

Returns a Markdown file that follows the [llms.txt convention](https://llmstxt.org).

The file has the site title as its heading, the site description as a quote, and one section per top-level sidebar
group. Each section lists its pages as links to their Markdown copies.

```md
# Shabd

> Documentation sites configured in YAML.

## Guide

- [Introduction](https://docs.example.com/guide/introduction.md): What Shabd is, and how its pieces fit together.
```

Pages that are not in the sidebar are listed last, under `Optional`.

## Related addresses

| Address | Returns |
| --- | --- |
| `/llms-full.txt` | Every page's Markdown in one file |
| `/<page>.md` | One page as Markdown |
| `/_shabd/search-index.json` | The search index: every section's text |
| `/_shabd/docs.json` | Every page's Markdown as JSON, for [hosting the MCP endpoint](../../features/mcp.md#in-production) |
